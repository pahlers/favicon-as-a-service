(function() {
    'use strict';
    /*jshint node:true*/

    var express = require('express'),
        deferred = require('deferred'),
        htmlparser = require('htmlparser2'),
        config = require('config'),
        _ = require('underscore'),

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
                        if (contenttypes[contenttype] || defaultFavicon) {
                            if (defaultFavicon) {
                                // Making an educated guess that it must be always a contenttype 'image/x-icon'.
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
                    console.log('Timeout favicon', liburl.format(url));

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
                                deferred.apply(null, todoList)(function(result) {
                                    // Try to get all the favicons.
                                    if (!_.isArray(result)) {
                                        result = [result];
                                    }

                                    def.resolve(result);

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
                    console.log('Timeout page', liburl.format(pageUrl));

                    def.resolve([]);
                    this.abort();
                });
            };


        loopGetPage(pageUrl);

        return def.promise;
    }

    function fileformatToPath(host, fileformat) {
        // Make a path from a hostname and file format
        var filename = host + '.' + fileformat;

        return libpath.join(config.cachePath, filename);
    }

    function contenttypeToPath(host, contenttype) {
        // Make a path from a hostname and content-type
        var fileformat = config.contenttypes[contenttype],
            filename = host + '.' + fileformat;

        return libpath.join(config.cachePath, filename);
    }

    function writeFaviconToCache(host, favicon) {
        // Write the favicon to the cache
        var path = contenttypeToPath(host, favicon.contenttype);

        libfs.writeFile(path, favicon.buffer, function(error) {
            if (error) {
                console.log('Error caching favicon:', error, path);
            }
        });
    }

    function readFaviconFromCache(url) {
        var def = deferred(),
            host = url.host,
            todoList = [],

            findFaviconInCache = function(path, fileformat) {
                var def = deferred();

                libfs.exists(path, function(exists) {
                    if (exists) {
                        def.resolve([path, fileformat]);

                    } else {
                        def.resolve();
                    }
                });

                return def.promise;
            };

        // Make a list of favicons with every fileformat to try.
        _.values(config.contenttypes).forEach(function(fileformat) {
            var path = fileformatToPath(host, fileformat);

            todoList.push(findFaviconInCache(path, fileformat));
        });

        deferred.apply(null, todoList)(function(results) {
            var path,
                fileformat,
                fileformats = _.invert(config.contenttypes),
                buffer;

            results.forEach(function(p) {
                if (p) {
                    path = p[0];
                    fileformat = p[1];
                }
            });

            if (path) {
                // Favicon founded, send it back.
                buffer = libfs.readFileSync(path);

                def.resolve({
                    buffer: buffer,
                    length: buffer.length,
                    contenttype: fileformats[fileformat],
                    url: url
                });

            } else {
                // No favicon found.
                def.resolve(false);
            }

        }, function(error) {
            def.resolve(false);
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
                    console.log('Making cache directory:', path);

                    def.resolve();
                });

            } else {
                // Does exist, doing nothing.
                console.log('Cache directory exists:', path);

                def.resolve();
            }
        });

        return def.promise;
    }

    function readDefaultFavicon() {
        var def = deferred(),
            path = libpath.join(__dirname, config.defaultFavicon.path);

        // Read default favicon.
        libfs.readFile(path, function(error, data) {
            if (!error) {
                // Save the data to the app-global 'defaultFavicon'.
                defaultFavicon = data;

                def.resolve();

            } else {
                throw new Error('Can\'t find default favicon: ' + path);
            }
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

            console.log('Search:', orgUrl);

            deferred(readFaviconFromCache(url))(function(result) {
                if (result) {
                    // Got the favicon from cache
                    console.log('Cache:', orgUrl);

                    res.writeHead(200, {
                        'Content-Type': result.contenttype,
                        'Content-Length': result.length
                    });

                    res.end(result.buffer);

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
                            // We have got a favicon! Save it and send it to our customers.
                            writeFaviconToCache(url.host, favicon);

                            console.log('Internet:', orgUrl);

                            res.writeHead(200, {
                                'Content-Type': favicon.contenttype,
                                'Content-Length': favicon.length
                            });

                            res.end(favicon.buffer);

                        } else {
                            // Default favicon, because we didn't found anything.
                            console.log('Default:', orgUrl);

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
            },
            function(error) {
                res.status(500);
                res.end();
            });

        } else {
            // /?url=http://missi.ng/url.html
            res.writeHead(300, {'Content-Type': 'text/plain'});
            res.end('/?url=http://missi.ng/url.html');
        }

    });

    // First: prepare webservice
    deferred(
        cacheDirectoryExists(),
        readDefaultFavicon()
    )(function(results) {
        // Second: start the webservice
        app.listen(config.server.port, config.server.host);

        console.log('Listening on port:', config.server.port, 'host:', config.server.host);

    }, function(error) {
        console.log('Oops!', error);
    });

}());
