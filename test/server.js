var vows = require("vows");
var assert = require("assert");

var server = require("../lib/server");
var http = require("../lib/http");
var ui = require("../lib/ui");
var visitor = require("../lib/visitor");

var Browser = require("../lib/browsers").Browser;
var Script = process.binding("evals").Script;

var PORT = 8088;

function request (path, body, method) {
    var options = {
        host : "localhost",
        port : PORT,
        method : "GET",
        path : path
    };
    if (body) options.body = body;
    if (method) options.method = method;
    return function (lastTopic) {
        var vow = this;
        if ("function" === typeof path)
            options.path = path(lastTopic);
        else if (!path)
            options.path = vow.context.name.split(/ +/)[1];
        http.request(
            options
        ).on("response", function X (res, results) {
            var err = null;
            if (res.statusCode !== 200)
                err = res.statusCode + " " + require("http").STATUS_CODES[res.statusCode];
            if (res.statusCode === 302) { // handle redirects
                options.path = res.headers.location;
                return http.request(options).on("response", X);
            }
            vow.callback(err, results);
        });
    }
}

function script () {
    return function (body) {
        var sandbox = { // super fake dom!
            window : {},
            document : {
                getElementById : function () {}
            }
        };
        Script.runInNewContext(body, sandbox);
        return sandbox;
    };
}

function exposeOnly (token) {
    return function (sandbox) {
        for (var i in sandbox) switch (i) {
            case "document":
            case "window":
            case token:
                break;
            default:
                return assert.fail(i + " should not be exposed");
        }
        assert.ok(1);
    };
}

vows.describe("HTTP Server").addBatch({
    "A Yeti server" : {
        topic : function() {
            server.serve(PORT, this.callback);
        },
        "should start" : function (err) {
            assert.isUndefined(err);
        },
        "when /inc/inject.js is requested" : {
            topic : request(),
            "the document should be valid JavaScript" : {
                    topic : script(),
                    "and have the function $yetify" : function (sandbox) {
                        assert.isFunction(sandbox.$yetify);
                    },
                    "and expose only $yetify" : exposeOnly("$yetify")
            },
            "the document should contain $yetify" : function (body) {
                assert.include(body, "$yetify");
            }
        },
        "when /inc/run.js is requested" : {
            topic : request(),
            "the document should be valid JavaScript" : {
                    topic : script(),
                    "and have the object YETI" : function (sandbox) {
                        assert.isObject(sandbox.YETI);
                    },
                    "and have the function YETI.start" : function (sandbox) {
                        assert.isFunction(sandbox.YETI.start);
                    },
                    "and expose only YETI" : exposeOnly("YETI")
            },
            "the document should contain YETI" : function (body) {
                assert.include(body, "YETI");
            }
        },
        "when /favicon.ico is requested" : {
            topic : request(),
            "there should be a response" : function () {
                assert.ok(1);
            }
        },
        "when an HTML document is requested" : {
            topic : request("/project/" + __dirname + "/fixture.html"),
            "the document should have $yetify" : function (body) {
                assert.isString(body);
                var injection = "<script src=\"/inc/inject.js\"></script><script>$yetify({url:\"/results\"});</script>";
                assert.include(body, injection);
                // injection appears at the end:
                var idx = body.indexOf(injection);
                assert.equal(
                    idx + injection.length,
                    body.length
                );
            }
        },
        "when a CSS document is requested" : {
            topic : request("/project/" + __dirname + "/fixture.css"),
            "the document should be served unmodified" : function (body) {
                assert.equal(body, "a{}\n");
            }
        },
        "when the test runner was requested" : {
            topic : function () {
                var vow = this;
                var cb = function (event, listener) {
                    if ("add" !== event) return;
                    vow.callback(null, listener);
                    server.tests.removeListener("newListener", cb);
                };
                server.tests.on("newListener", cb);
                visitor.visit(
                    [ Browser.canonical() ],
                    ["http://localhost:" + PORT]
                );
            },
            "the server listens to the test add event" : function (listener) {
                assert.isFunction(listener);
            },
            "and a test is added" : {
                topic : request(
                    "/tests/add",
                    { tests : [ __dirname + "/fixture.html" ] },
                    "PUT"
                ), 
                "the test id is returned" : function (id) {
                    assert.isString(id);
                },
                "and the status is requested" : {
                    topic : request(function (id) {
                        return "/status/" + id;
                    }),
                    "the test data is returned" : function (results) {
                        assert.isObject(results);
                        assert.include(results, "passed");
                        assert.include(results, "failed");
                        assert.include(results, "name");
                        assert.include(results, "total");
                    },
                    "the suite passed" : function (result) {
                        assert.ok(result.passed);
                        assert.equal(result.failed, 0);
                    }
                }
            }
        }
    }
}).export(module);