(function() {
    'use strict';
    /*jshint node:true*/

    var express = require('express'),
        deferred = require('deferred'),
        htmlparser = require('htmlparser2'),
        config = require('config'),
        liburl = require('url'),
        _ = require('underscore'),

        protocols = {
            http: require('http'),
            https: require('https')
        },
        
        app = express();

    function getCompleteUrl(orgUrl, pageUrl){
        //complete the url with a protocol
        //        www.google.nl --> http://www.google.nl
        //      //www.google.nl --> http://www.google.nl
        // http://www.google.nl --> http://www.google.nl

        console.log('getCompleteUrl', orgUrl);

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

    function getFavicon(url, def) {
        // set headers
        var path = url.pathname;

        console.log('Get the favicon', liburl.format(url));

        protocols[url.protocol.slice(0, -1)].get(liburl.format(url), function(res) {
            var chunks = [],
                length = 0,
                redirectUrl;

            console.log('PING0');

            if (res.statusCode === 200) {
                res.on('data', function (chunk) {
                    chunks.push(chunk);
                    length += chunk.length;

                }).on('end', function () {

                    def.resolve({
                        buffer: Buffer.concat(chunks, length),
                        length: length,
                        mimetype: res.headers['content-type'], 
                        url: url
                    });

                    console.log('PING1');

                });

            } else if (res.statusCode === 301 || res.statusCode === 302) {
                redirectUrl = res.headers.location;

                console.log('Redirect favicon from', liburl.format(url), 'to', redirectUrl);
                
                if(config.contenttypes[res.headers['content-type']]){
                    getFavicon(liburl.parse(redirectUrl), def);
                } else {
                    console.log('redirect', redirectUrl, path);
                    getFavicon(liburl.parse(liburl.resolve(redirectUrl, path)), def);
                }

            } else {
                console.log('PING3 from',liburl.format(url), 'to',res.headers.location, res.statusCode, res.headers['content-type']);
                def.resolve({});
            }

        }).on('error', function(e) {
            console.log("Got error: " + e.message);

            def.resolve({});
        });

        return def.promise;
    }

    function getPage(pageUrl, pageDeferred) {
        var faviconsList = [],
            mimetype,
            parser = new htmlparser.Parser({
                onopentag: function(name, attribs){
                    var rel = 'msapplication-TileImage,icon,shortcut icon,apple-touch-icon,apple-touch-icon-precomposed';

                    if((name === 'link' && rel.indexOf(attribs.rel) !== -1) || (name === 'meta' && rel.indexOf(attribs.name) !== -1)){
                        faviconsList.push(getFavicon(getCompleteUrl(attribs.href, pageUrl), deferred()));
                    }
                }
            });

        // set headers
        pageUrl.headers = config.headers;
        protocols[pageUrl.protocol.slice(0, -1)].get(pageUrl, function(res) {
            var chunks = [],
                length = 0,
                redirectUrl;

            console.log('LALALA0');

            if (res.statusCode === 200) {
                // get default favicon http://www.example.com/favicon.ico
                faviconsList.push(getFavicon(liburl.parse(liburl.resolve(pageUrl.href, '/favicon.ico')), deferred()));

                // get favicons from html source
                res.on('data', function (chunk) {
                    parser.write(chunk.toString());
                    length += chunk.length;
                    
                }).on('end', function () {
                    parser.done();

                    if(faviconsList.length > 0){
                        deferred.apply(null, faviconsList)(function(result) {
                            // result
                            if(!_.isArray(result)){
                                result = [result];
                            }

                            console.log('here results', result);
                            pageDeferred.resolve(result);

                        }, function(error) {
                            // error
                            pageDeferred.resolve([]);

                            console.log('ERROR getPage:', error);
                        });
                    }

                    // There are no favicons in html
                    pageDeferred.resolve([]);
                });

            } else if (res.statusCode === 301 || res.statusCode === 302) {
                redirectUrl = getCompleteUrl(res.headers.location);
                redirectUrl.headers = config.headers;

                console.log('Redirect page from', liburl.format(redirectUrl), 'to', res.headers.location);

                // check new page
                // TODO: WOOOOPS
                getPage(redirectUrl, pageDeferred);

            } else {
                console.log('KAK');
                pageDeferred.resolve([]);
            }

        }).on('error', function(e) {
            console.log("Got error: " + e.message);

            pageDeferred.resolve([]);
        });

        return pageDeferred.promise;
    }

    app.get('/', function(req, res) {
        var orgUrl,
            url;

        
        if((orgUrl = req.query.url)){
            url = getCompleteUrl(orgUrl);

            console.log('Get favicons from page:', orgUrl);

            // Get all the favicons and choose the biggest.

            // First get default favicon http://www.example.com/favicon.ico
            deferred(
                // getFavicon(
                //     {
                //         protocol: url.protocol,
                //         host: url.host,
                //         pathname: '/favicon.ico'
                //     }, 
                //     deferred()
                // ),
                getPage(
                    url, 
                    deferred()
                )
            )(function(results){
                console.log('results', results);

                // results
                var favicon,
                    length = 0;

                results[1].push(results[0]);
                results = results[1];

                results.forEach(function(fav, index) {
                    var l = fav.length;

                    if(l > length){
                        favicon = fav;
                        length = l;
                    }
                });

                if(favicon){
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
                //error

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