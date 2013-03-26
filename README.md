# Favicon as a Service

A simple favicon web service powered by [Express](http://expressjs.com) and [NodeJs](http://nodejs.org/). With a lot inspiration from [Screenshot-as-a-service](https://github.com/fzaninotto/screenshot-as-a-service), [Node-favicon](https://github.com/aol/node-favicon) and [getfavicon](https://github.com/potatolondon/getfavicon).

## Setup

First clone this repo and install the deps:

```
$ npm install
```

Run the app:

```
$ node app
Express server listening on port 8080
```

## Usage

Open a browser and go to:

```
http://localhost:8080/?url=www.google.com
```

## Settings

```json
{
    "server": {
        "host": "localhost",
        "port": 8080
    },
    "cachePath": "/tmp/favicon-as-a-server",
    "defaultFavicon": { 
        "path": "config/favicon.ico",
        "contenttype": "image/x-icon"
    },
    
    "serveExamples": true,
    "timeout": {
        "page": 60000,
        "favicon": 60000
    },
    "maxRedirects": 3,
    "headers": { 
        "cache-control": "max-age=0",
        "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_8_2) AppleWebKit/537.35 (KHTML, like Gecko) Chrome/27.0.1444.3 Safari/537.35",
        "accept-encoding": "gzip,deflate"
    },

    "contenttypes": {
        "image/vnd.microsoft.icon": "ico",
        "image/x-icon": "ico",
        "image/png": "png",
        "image/gif": "gif"
    },

    "elementtypes": [
        "msapplication-TileImage",
        "icon",
        "shortcut icon",
        "apple-touch-icon",
        "apple-touch-icon-precomposed"
    ]
}
```

## Todo
* implement mime-magic
* return 304
* remove cached files after a date
* scale favicons on the fly

## Thanks

Big thanks to:
* Ron Thijssen, <https://github.com/ronthijssen>

## License

The MIT License (MIT)
Copyright (c) 2013 Peter Ahlers <peter.ahlers@gmail.com>

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.