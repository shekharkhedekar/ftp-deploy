"use strict";
var __extends = (this && this.__extends) || (function () {
    var extendStatics = function (d, b) {
        extendStatics = Object.setPrototypeOf ||
            ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
            function (d, b) { for (var p in b) if (Object.prototype.hasOwnProperty.call(b, p)) d[p] = b[p]; };
        return extendStatics(d, b);
    };
    return function (d, b) {
        if (typeof b !== "function" && b !== null)
            throw new TypeError("Class extends value " + String(b) + " is not a constructor or null");
        extendStatics(d, b);
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    };
})();
var upath = require("upath");
var events = require("events");
var Promise = require("bluebird");
var fs = require("fs");
var PromiseFtp = require("promise-ftp");
var PromiseSftp = require("ssh2-sftp-client");
var lib = require("./lib");
/* interim structure
{
    '/': ['test-inside-root.txt'],
    'folderA': ['test-inside-a.txt'],
    'folderA/folderB': ['test-inside-b.txt'],
    'folderA/folderB/emptyC': [],
    'folderA/folderB/emptyC/folderD': ['test-inside-d-1.txt', 'test-inside-d-2.txt']
}
*/
var FtpDeployer = /** @class */ (function (_super) {
    __extends(FtpDeployer, _super);
    function FtpDeployer(config) {
        var _this = _super.call(this) || this;
        _this.makeAllAndUpload = function (filemap) {
            var _this = this;
            var keys = Object.keys(filemap);
            return Promise.mapSeries(keys, function (key) {
                return _this.makeAndUpload(key, filemap[key]);
            });
        };
        _this.makeDir = function (newDirectory) {
            if (newDirectory === "/") {
                return Promise.resolve("unused");
            }
            else {
                return this.ftp.mkdir(newDirectory, true);
            }
        };
        // Creates a remote directory and uploads all of the files in it
        // Resolves a confirmation message on success
        _this.makeAndUpload = function (relDir, fnames) {
            var _this = this;
            var newDirectory = upath.join(this.config.remoteRoot, relDir);
            return this.makeDir(newDirectory, true).then(function () {
                return Promise.mapSeries(fnames, function (fname) {
                    var tmpFileName = upath.join(_this.config.localRoot, relDir, fname);
                    var tmp = fs.readFileSync(tmpFileName);
                    _this.eventObject["filename"] = upath.join(relDir, fname);
                    _this.emit("uploading", _this.eventObject);
                    return _this.ftp
                        .put(tmp, upath.join(_this.config.remoteRoot, relDir, fname))
                        .then(function () {
                        _this.eventObject.transferredFileCount++;
                        _this.emit("uploaded", _this.eventObject);
                        return Promise.resolve("uploaded " + tmpFileName);
                    })
                        .catch(function (err) {
                        _this.eventObject["error"] = err;
                        _this.emit("upload-error", _this.eventObject);
                        // if continue on error....
                        return Promise.reject(err);
                    });
                });
            });
        };
        // connects to the server, Resolves the config on success
        _this.connect = function () {
            // sftp client does not provide a connection status
            // so instead provide one ourselfs
            if (_this.config.sftp) {
                _this.connectionStatus = "disconnected";
                _this.ftp.on("end", _this.handleDisconnect);
                _this.ftp.on("close", _this.handleDisconnect);
            }
            return _this.ftp
                .connect(_this.config)
                .then(function (serverMessage) {
                _this.emit("log", "Connected to: " + _this.config.host);
                _this.emit("log", "Connected: Server message: " + serverMessage);
                // sftp does not provide a connection status
                // so instead provide one ourself
                if (_this.config.sftp) {
                    _this.connectionStatus = "connected";
                }
                return _this.config;
            })
                .catch(function (err) {
                return Promise.reject({
                    code: err.code,
                    message: "connect: " + err.message,
                });
            });
        };
        _this.getConnectionStatus = function () {
            // only ftp client provides connection status
            // sftp client connection status is handled using events
            return typeof _this.ftp.getConnectionStatus === "function"
                ? _this.ftp.getConnectionStatus()
                : _this.connectionStatus;
        };
        _this.handleDisconnect = function () {
            _this.connectionStatus = "disconnected";
        };
        // creates list of all files to upload and starts upload process
        _this.checkLocalAndUpload = function () {
            try {
                var filemap = lib.parseLocal(_this.config.include, _this.config.exclude, _this.config.localRoot, "/");
                _this.emit("log", "Files found to upload: " + JSON.stringify(filemap));
                _this.eventObject["totalFilesCount"] = lib.countFiles(filemap);
                return _this.makeAllAndUpload(filemap);
            }
            catch (e) {
                return Promise.reject(e);
            }
        };
        // Deletes remote directory if requested by config
        // Returns config
        _this.deleteRemote = function () {
            if (_this.config.deleteRemote) {
                return lib
                    .deleteDir(_this.ftp, _this.config.remoteRoot)
                    .then(function () {
                    _this.emit("log", "Deleted directory: " + _this.config.remoteRoot);
                    return _this.config;
                })
                    .catch(function (err) {
                    _this.emit("log", "Deleting failed, trying to continue: " +
                        JSON.stringify(err));
                    return Promise.resolve(_this.config);
                });
            }
            return Promise.resolve(_this.config);
        };
        _this.deploy = function (cb) {
            var _this = this;
            return lib
                .checkIncludes(this.config)
                .then(lib.getPassword)
                .then(this.connect)
                .then(this.deleteRemote)
                .then(this.checkLocalAndUpload)
                .then(function (res) {
                _this.ftp.end();
                if (typeof cb == "function") {
                    cb(null, res);
                }
                else {
                    return Promise.resolve(res);
                }
            })
                .catch(function (err) {
                if (_this.ftp && _this.getConnectionStatus() != "disconnected")
                    _this.ftp.end();
                if (typeof cb == "function") {
                    cb(err, null);
                }
                else {
                    return Promise.reject(err);
                }
            });
        };
        _this.config = config;
        _this.ftp = _this.config.sftp ? new PromiseSftp() : new PromiseFtp();
        _this.eventObject = {
            totalFilesCount: 0,
            transferredFileCount: 0,
            filename: "",
        };
        return _this;
    }
    return FtpDeployer;
}(events.EventEmitter));
module.exports = FtpDeployer;
