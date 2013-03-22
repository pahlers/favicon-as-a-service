(function() {
    'use strict';
    /*jshint node:true*/

    var express = require('express'),
        deferred = require('deferred'),
        htmlparser = require('htmlparser2'),
        config = require('config'),
        liburl = require('url'),
        zlib = require('zlib'),
        _ = require('underscore'),

        protocols = {
            http: require('http'),
            https: require('https')
        },
        
        app = express();

    function addProtocolToUrl(orgUrl){
        //complete the url with a protocol
        //        www.google.nl --> http://www.google.nl
        //      //www.google.nl --> http://www.google.nl
        // http://www.google.nl --> http://www.google.nl

        var url = liburl.parse(orgUrl),
            urlStart = 'http:';

        if(!url.protocol){
            if(orgUrl.indexOf('//') !== 0){
                urlStart += '//';
            }

            url = liburl.parse(urlStart + orgUrl);
        }
        return url;
    }

    function getBase64Favicon (data, contenttype) {
        return {
            buffer: data,
            length: data.length,
            mimetype: contenttype
        };
    }

    function getFavicon(url, defaultFavicon) {
        var path = url.pathname,
            def = deferred(),

            numberOfRedirects = 0,
            maxRedirects = config.maxRedirects,
            contenttypes = config.contenttypes,

            loopGetFavicon = function (url) {
                // console.log('Try to get favicon', liburl.format(url));

                var req = protocols[url.protocol.slice(0, -1)].get(liburl.format(url), function(res) {
                    var chunks = [],
                        length = 0,
                        redirectUrl,
                        contenttype = res.headers['content-type'];


                    if (res.statusCode === 200){
                        if(contenttypes[contenttype] || defaultFavicon){
                            // console.log('Got favicon', liburl.format(url));

                            if(defaultFavicon){
                                //Making a educated guess that is must be always a contenttype 'image/x-icon'
                                contenttype = 'image/x-icon';
                            }

                            res.on('data', function (chunk) {
                                chunks.push(chunk);
                                length += chunk.length;

                            }).on('end', function () {
                                def.resolve({
                                    buffer: Buffer.concat(chunks, length),
                                    length: length,
                                    mimetype: contenttype, 
                                    url: url
                                });
                            });
                        } else {
                            // console.log('PING4 from',liburl.format(url), 'to',res.headers.location, res.statusCode, res.headers['content-type']);
                            def.resolve({});
                        }

                    } else if (res.statusCode === 301 || res.statusCode === 302) {
                        if(numberOfRedirects > maxRedirects){
                            // to much redirects, call it a day
                            def.resolve({});

                        } else {
                            numberOfRedirects += 1;

                            redirectUrl = addProtocolToUrl(res.headers.location);

                            if(!redirectUrl.host){
                                redirectUrl = liburl.parse(liburl.resolve(url, redirectUrl.pathname));
                            }

                            // console.log('Redirect favicon from', liburl.format(url), 'to', liburl.format(redirectUrl));
                            
                            if(contenttypes[contenttype]){
                                loopGetFavicon(liburl.parse(redirectUrl));
                            } else {
                                loopGetFavicon(liburl.parse(liburl.resolve(redirectUrl, path)));
                            }
                        }

                    } else {
                        // console.log('PING3 from',liburl.format(url), 'to',res.headers.location, res.statusCode, res.headers['content-type']);
                        def.resolve({});
                    }

                }).on('error', function(e) {
                    console.log("Got favicon error:", liburl.format(url), e.message);

                    def.resolve({});

                });
            };

        loopGetFavicon(url);

        return def.promise;
    }

    function getPage(pageUrl) {
        var def = deferred(),
            faviconsList = [],

            parser = new htmlparser.Parser({
                onopentag: function(name, attribs){
                    var rel = config.elementtypes.join(','),
                        orgUrl,
                        url,
                        regexp = new RegExp('^data:([A-Za-z0-9/]*);base64,'),
                        contenttype;

                    if((name === 'link' && rel.indexOf(attribs.rel) !== -1) || (name === 'meta' && rel.indexOf(attribs.name) !== -1)){
                        orgUrl = attribs.href || attribs.content;

                        if(orgUrl && orgUrl.length > 0){
                            if((contenttype = orgUrl.match(regexp))){
                                // base64
                                if(config.contenttypes[contenttype]){
                                    faviconsList.push(getBase64Favicon(orgUrl, contenttype));
                                }

                            } else {
                                // url
                                url = liburl.parse(orgUrl);

                                if(!url.host){
                                    url = liburl.parse(liburl.resolve(pageUrl, url.pathname));
                                }

                                faviconsList.push(getFavicon(addProtocolToUrl(liburl.format(url))));
                            }
                        }
                    }
                }
            }),

            numberOfRedirects = 0,
            maxRedirects = config.maxRedirects,

            gzip = zlib.createGunzip(),
            deflate = zlib.createDeflate(),

            loopGetPage = function (url) {
                // set headers
                url.headers = config.headers;
                protocols[url.protocol.slice(0, -1)].get(url, function(res) {
                    var chunks = [],
                        length = 0,
                        redirectUrl,
                        contentencoding = res.headers['content-encoding'],
                        html;

                    // get default favicon http://www.example.com/favicon.ico
                    faviconsList.push(getFavicon(liburl.parse(liburl.resolve(url.href, '/favicon.ico')), true));
                    
                    if (res.statusCode === 200) {

                        // gzip, deflate or nothing
                        if(contentencoding === 'gzip') {
                            res.pipe(gzip);
                            html = gzip;
                        } else if(contentencoding === 'deflate') {
                            res.pipe(deflate);
                            html = deflate;
                        } else {
                            html = res;
                        }

                        // Get favicons from html source
                        html.on('data', function (chunk) {
                            parser.write(chunk.toString());
                            length += chunk.length;
                            
                        }).on('end', function () {
                            parser.done();

                            if(faviconsList.length > 0){
                                deferred.apply(null, faviconsList)(function(result) {
                                    // results
                                    if(!_.isArray(result)){
                                        result = [result];
                                    }

                                    def.resolve(result);

                                }, function(error) {
                                    // error
                                    def.resolve([]);

                                    console.log('ERROR getPage:', error);
                                });

                            } else {
                                def.resolve([]);
                            }
                        });

                    } else if (res.statusCode === 301 || res.statusCode === 302) {
                        if(numberOfRedirects > maxRedirects){
                            // to much redirects, call it a day
                            def.resolve({});

                        } else {
                            numberOfRedirects +=1;

                            redirectUrl = addProtocolToUrl(res.headers.location);

                            if(!redirectUrl.host){
                                redirectUrl = liburl.parse(liburl.resolve(url, redirectUrl.pathname));
                            }

                            redirectUrl.headers = config.headers;

                            // console.log('Redirect page from', liburl.format(url), 'to', liburl.format(redirectUrl));

                            // check new page
                            loopGetPage(redirectUrl);
                        }
                    } else {
                        def.resolve([]);
                    }

                }).on('error', function(e) {
                    console.log("Got page error:", liburl.format(pageUrl), e.message);

                    def.resolve([]);

                }).setTimeout(config.timeout, function () {
                    console.log('Timeout page', liburl.format(pageUrl));

                    def.resolve([]);
                    this.end();
                });
            };


        loopGetPage(pageUrl);

        return def.promise;
    }

    app.get('/', function(req, res) {
        var orgUrl,
            url;

        
        if((orgUrl = req.query.url)){
            url = addProtocolToUrl(orgUrl);

            console.log('Searching on page:', orgUrl);

            // Get all the favicons and choose the biggest.

            deferred(getPage(url))(function(results){
                // results
                var favicon,
                    length = 0;

                results.forEach(function(fav, index) {
                    var l = fav.length;

                    if(l > length){
                        favicon = fav;
                        length = l;
                    }
                });

                if(favicon && favicon.buffer){
                    res.writeHead(200, {
                        'Content-Type': favicon.mimetype,
                        'Content-Length': favicon.length
                    });

                    res.end(favicon.buffer);
                } else {
                    res.status(404);
                    res.end();
                }

            }, function(error){
                // error

                console.error('ERROR: Ooops');
                console.error(error);

                res.status(500);
                res.end();
            });
        } else {
            console.error('ERROR: url missing');

            res.writeHead(300, {'Content-Type': 'text/plain'});
            res.end('/?url=http://missi.ng/url.html');
        }
    });

    // app.get('/test.html', function(req, res) {
    //     var html = ''
    // });

    app.listen(config.server.port, config.server.host);

    console.log('Listening on port:', config.server.port, 'host:', config.server.host);
}());