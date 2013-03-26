(function() {
    'use strict';
    /*jshint node:true*/

    // External modules
    var express = require('express'),
        deferred = require('deferred'),
        htmlparser = require('htmlparser2'),
        config = require('config'),
        _ = require('underscore'),
        mime = require('mime-magic'),
        md5 = require('MD5'),


        // Node modules
        liburl = require('url'),
        libfs = require('fs'),
        libpath = require('path'),
        libzlib = require('zlib'),
        protocols = {
            http: require('http'),
            https: require('https')
        },

        defaultFavicon,
        app = express();

    function addProtocolToUrl(orgUrl) {
        // Complete the url with a protocol
        //        www.google.nl --> http://www.google.nl
        //      //www.google.nl --> http://www.google.nl
        // http://www.google.nl --> http://www.google.nl

        var url = liburl.parse(orgUrl),
            urlStart = 'http:';

        if (!url.protocol) {
            if (orgUrl.indexOf('//') !== 0) {
                urlStart += '//';
            }

            url = liburl.parse(urlStart + orgUrl);
        }

        return url;
    }

    function getBase64Favicon(data, contenttype) {
        return {
            buffer: data,
            length: data.length,
            contenttype: contenttype
        };
    }

    function getFavicon(url, defaultFavicon) {
        var path = url.path,
            def = deferred(),

            numberOfRedirects = 0,
            maxRedirects = config.maxRedirects,
            contenttypes = config.contenttypes,

            loopGetFavicon = function(url) {
                protocols[url.protocol.slice(0, -1)].get(liburl.format(url), function(res) {
                    var chunks = [],
                        length = 0,
                        redirectUrl,
                        contenttype = res.headers['content-type'];

                    if (res.statusCode === 200) {

                        // Some developers find content types as "image/png;charset=UTF-8" better, I disagree.
                        if(contenttype){
                            contenttype = contenttype.split(';')[0].trim();
                        }

                        if (contenttypes[contenttype] || defaultFavicon) {
                            if (defaultFavicon) {
                                // Making an educated guess that it must be always a content-type 'image/x-icon'.
                                contenttype = 'image/x-icon';
                            }

                            res.on('data', function(chunk) {
                                chunks.push(chunk);
                                length += chunk.length;

                            }).on('end', function() {
                                def.resolve({
                                    buffer: Buffer.concat(chunks, length),
                                    length: length,
                                    contenttype: contenttype,
                                    url: url
                                });
                            });
                        } else {
                            console.info('Info: found an unsupported content-type', liburl.format(url), contenttype);

                            def.resolve({});
                        }

                    } else if (res.statusCode === 301 || res.statusCode === 302) {
                        if (numberOfRedirects > maxRedirects) {
                            // To much redirects, call it a day.
                            def.resolve({});

                        } else {
                            // Follow the redirect.
                            numberOfRedirects += 1;

                            redirectUrl = addProtocolToUrl(res.headers.location);

                            // Relative path, add the current host to it.
                            if (!redirectUrl.host) {
                                redirectUrl = liburl.parse(liburl.resolve(url, redirectUrl.path));
                            }

                            // Check if the content-type is one we want, else try with the path we had in the first place.
                            if (contenttypes[contenttype]) {
                                loopGetFavicon(liburl.parse(redirectUrl));
                            } else {
                                loopGetFavicon(liburl.parse(liburl.resolve(redirectUrl, path)));
                            }
                        }

                    } else {
                        def.resolve({});
                    }

                }).on('error', function(e) {
                    def.resolve({});

                }).setTimeout(config.timeout.favicon, function() {
                    console.info('Info: timeout favicon', liburl.format(url));

                    def.resolve({});
                    this.abort();
                });
            };

        loopGetFavicon(url);

        return def.promise;
    }

    function getPage(pageUrl) {
        var def = deferred(),
            todoList = [],

            parser = new htmlparser.Parser({
                onopentag: function(name, attribs) {
                    var rel = config.elementtypes.join(','),
                        orgUrl,
                        url,
                        regexp = new RegExp('^data:([A-Za-z0-9/]*);base64,'),
                        contenttype;

                    // Accepting only element <link> or <meta>
                    if ((name === 'link' && rel.indexOf(attribs.rel) !== -1) || (name === 'meta' && rel.indexOf(attribs.name) !== -1)) {
                        orgUrl = attribs.href || attribs.content;

                        // Attribute href or content must contain a string.
                        if (orgUrl && orgUrl.length > 0) {
                            if ((contenttype = orgUrl.match(regexp))) {
                                // Base64 image
                                if (config.contenttypes[contenttype]) {
                                    todoList.push(getBase64Favicon(orgUrl, contenttype));
                                }

                            } else {
                                // Path to image
                                url = liburl.parse(orgUrl);

                                if (!url.host) {
                                    url = liburl.parse(liburl.resolve(pageUrl, url.path));
                                }

                                todoList.push(getFavicon(addProtocolToUrl(liburl.format(url))));
                            }
                        }
                    }
                }
            }),

            numberOfRedirects = 0,
            maxRedirects = config.maxRedirects,

            gzip = libzlib.createGunzip(),
            deflate = libzlib.createDeflate(),

            loopGetPage = function(url) {
                // Set headers
                url.headers = config.headers;

                // Get the page (using http or https)
                protocols[url.protocol.slice(0, -1)].get(url, function(res) {
                    var chunks = [],
                        length = 0,
                        redirectUrl,
                        contentencoding = res.headers['content-encoding'],
                        html;

                    if (res.statusCode === 200) {
                        // Get default favicon http://www.example.com/favicon.ico
                        todoList.push(getFavicon(liburl.parse(liburl.resolve(url.href, '/favicon.ico')), true));

                        // Gzip, deflate or nothing
                        if (contentencoding === 'gzip') {
                            res.pipe(gzip);
                            html = gzip;
                        } else if (contentencoding === 'deflate') {
                            res.pipe(deflate);
                            html = deflate;
                        } else {
                            html = res;
                        }

                        // Get favicons from html source
                        html.on('data', function(chunk) {
                            // Parse every chunk to find links to favicons
                            parser.write(chunk.toString());
                            length += chunk.length;

                        }).on('end', function() {
                            parser.done();

                            if (todoList.length > 0) {
                                deferred.apply(null, todoList)(function(results) {
                                    // Try to get all the favicons.
                                    if (!_.isArray(results)) {
                                        results = [results];
                                    }

                                    def.resolve(results);

                                }, function(error) {
                                    def.resolve([]);
                                });

                            } else {
                                def.resolve([]);
                            }
                        });

                    } else if (res.statusCode === 301 || res.statusCode === 302) {
                        if (numberOfRedirects > maxRedirects) {
                            // To much redirects, call it a day
                            def.resolve({});

                        } else {
                            // Follow the redirect
                            numberOfRedirects += 1;

                            redirectUrl = addProtocolToUrl(res.headers.location);

                            if (!redirectUrl.host) {
                                redirectUrl = liburl.parse(liburl.resolve(url, redirectUrl.path));
                            }

                            redirectUrl.headers = config.headers;

                            // Check new page
                            loopGetPage(redirectUrl);
                        }

                    } else {
                        def.resolve([]);
                    }

                }).on('error', function(e) {
                    def.resolve([]);

                }).setTimeout(config.timeout.page, function() {
                    console.info('Info: timeout page', liburl.format(pageUrl));

                    def.resolve([]);
                    this.abort();
                });
            };


        loopGetPage(pageUrl);

        return def.promise;
    }

    function writeFaviconToCache(host, favicon) {
        var def = deferred(),
            path = libpath.join(config.cachePath, host);

        // Write the favicon to the cache
        libfs.writeFile(path, favicon.buffer, function(error) {

            //Get mtime for the headers last-modfied and etag
            deferred(statsFavicon(path))(function(results) {
                var mtime = results.mtime.toString().trim();

                def.resolve({
                    lastmodified: mtime,
                    etag: md5(mtime + config.etagSalt)
                });

            }, function(error) {
                def.resolve(false);

                console.error('Error: writeFaviconToCache', path, error);
            });
        });

        return def.promise;        
    }

    function readFavicon(path) {
        var def = deferred();

        // Read favicon.
        libfs.readFile(path, function(error, data) {
            if (!error) {
                def.resolve(data);

            } else {
                def.resolve(false);

                console.error('Error: readFavicon', path, error);
            }
        });

        return def.promise;
    }

    function statsFavicon(path) {
        var def = deferred();

        libfs.stat(path, function(error, stats) {
            if(!error){
                def.resolve(stats);

            } else {
                def.resolve();

                console.error('Error: statsFavicon', path, error);
            }
        });

        return def.promise;
    }

    function contenttypeFavicon(path) {
        var def = deferred();

        mime(path, function(error, type) {
            if(!error) {
                def.resolve(type);

            } else {
                def.resolve();

                console.error('Error: contenttypeFavicon', path, error);
            }
        });

        return def.promise;
    }

    function readFaviconFromCache(url) {
        var def = deferred(),
            host = url.host,
            path = libpath.join(config.cachePath, host);

        // Check if favicon exists.
        libfs.exists(path, function(exists) {
            if(exists){

                // Get favicon, stats and content-type.
                deferred(
                    readFavicon(path),
                    statsFavicon(path),
                    contenttypeFavicon(path)
                )(function(results) {
                    var buffer = results[0],
                        stats = results[1],
                        contenttype = results[2],
                        mtime = stats.mtime.toString();

                    def.resolve({
                        buffer: buffer,
                        length: stats.size,
                        lastmodified: mtime,
                        etag: md5(mtime + config.etagSalt),
                        contenttype: contenttype,
                        url: liburl.format(url)
                    });

                }, function(error) {
                    def.resolve(false);

                    console.error('Error: readFaviconFromCache', path, error);
                });

            } else {
                def.resolve(false);
            }
        });

        return def.promise;
    }

    function cacheDirectoryExists() {
        var def = deferred(),
            path = config.cachePath;

        // Check if cache direcctory exists
        libfs.exists(path, function(exists) {
            if (!exists) {
                // Doesn't exist, make one!
                libfs.mkdir(config.cachePath, function() {
                    console.info('Info: making cache directory:', path);

                    def.resolve();
                });

            } else {
                // Does exist, doing nothing.
                console.info('Info: cache directory exists:', path);

                def.resolve();
            }
        });

        return def.promise;
    }

    function readDefaultFavicon() {
        var def = deferred(),
            path = libpath.join(__dirname, config.defaultFavicon.path);

        // Read default favicon.
        deferred(readFavicon(path))(function(results) {
            if(results){
                // Save the data to the app-global 'defaultFavicon'.
                defaultFavicon = results;
                def.resolve();

            } else {
                throw new Error('Can\'t find default favicon: ' + path);
            }

        }, function(error) {
            throw new Error('Can\'t find default favicon: ' + path);
        });

        return def.promise;
    }


    if (config.serveExamples === true) {
        app.use('/test', express.static(__dirname + '/test'));
        app.use('/test', express.directory(__dirname + '/test'));
    }

    // Default webservice path.
    app.get('/', function(req, res) {
        var orgUrl,
            url,
            cachedFavicon;

        if ((orgUrl = req.query.url)) {
            // Get favicon.
            url = addProtocolToUrl(orgUrl);

            console.info('Search:', orgUrl);

            // Try to get the favicon from cache
            deferred(readFaviconFromCache(url))(function(results) {
                if (results) {
                    // Got the favicon from cache
                    var ifModifiedSince = req.get('If-Modified-Since'),
                        ifNoneMatch = req.get('If-None-Match');

                    if(ifModifiedSince === results.lastmodified && ifNoneMatch === results.etag){
                        console.info('Cache 304:', orgUrl);
                        
                        res.status(304);
                        res.end();

                    } else {
                        console.info('Cache 200:', orgUrl);

                        res.writeHead(200, {
                            'Content-Type': results.contenttype,
                            'Content-Length': results.length,
                            'Last-Modified': results.lastmodified,
                            'ETag': results.etag
                        });
                        res.end(results.buffer);
                    }

                } else {
                    // Get all the favicons from the internet and choose the biggest.
                    deferred(getPage(url))(function(results) {
                        var favicon,
                            length = 0;

                        // Check the length of the buffer to get the largest favicon.
                        results.forEach(function(fav, index) {
                            var l = fav.length;

                            if (l > length) {
                                favicon = fav;
                                length = l;
                            }
                        });

                        if (favicon && favicon.buffer) {
                            console.info('Internet:', orgUrl);

                            // We have got a favicon! Save it and send it to our customers.
                            deferred(writeFaviconToCache(url.host, favicon))(function(results) {
                                res.writeHead(200, {
                                    'Content-Type': favicon.contenttype,
                                    'Content-Length': favicon.length,
                                    'Last-Modified': results.lastmodified,
                                    'ETag': results.etag
                                });

                                res.end(favicon.buffer);

                            }, function(error) {
                                console.warn('Warn: didn\'t write to cache.', error);

                                res.writeHead(200, {
                                    'Content-Type': favicon.contenttype,
                                    'Content-Length': favicon.length
                                });

                                res.end(favicon.buffer);
                            });

                        } else {
                            // Default favicon, because we didn't found anything.
                            console.info('Default:', orgUrl);

                            res.writeHead(200, {
                                'Content-Type': config.defaultFavicon.contenttype,
                                'Content-Length': defaultFavicon.length
                            });

                            res.end(defaultFavicon);
                        }

                    }, function(error) {
                        res.status(500);
                        res.end();
                    });
                }
                
            }, function(error) {
                res.status(500);
                res.end();
            });

        } else {
            // /?url=http://missi.ng/url.html.
            res.writeHead(300, {'Content-Type': 'text/plain'});
            res.end('/?url=http://missi.ng/url.html');
        }

    });

    // First: prepare webservice. Check the cache directory and read the default favicon.
    deferred(
        cacheDirectoryExists(),
        readDefaultFavicon()
    )(function(results) {
        // Second: start the webservice.
        app.listen(config.server.port, config.server.host);

        console.info('Info: listening on port:', config.server.port, 'host:', config.server.host);

    }, function(error) {
        console.error('Error: startup service', error);
    });

}());
