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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
var upath_1 = __importDefault(require("upath"));
var events_1 = __importDefault(require("events"));
var bluebird_1 = __importDefault(require("bluebird"));
var fs_1 = __importDefault(require("fs"));
var promise_ftp_1 = __importDefault(require("promise-ftp"));
var ssh2_sftp_client_1 = __importDefault(require("ssh2-sftp-client"));
var lib = __importStar(require("./lib"));
var FtpDeployer = /** @class */ (function (_super) {
    __extends(FtpDeployer, _super);
    function FtpDeployer(config) {
        var _this = _super.call(this) || this;
        _this.makeAllAndUpload = function (filemap) {
            var keys = Object.keys(filemap);
            return bluebird_1.default.mapSeries(keys, function (key) {
                return _this.makeAndUpload(key, filemap[key]);
            });
        };
        // Wrapper of this.ftp.put to handle disparate returns of PromiseFtp and PromiseSftp
        _this.ftpPut = function (f, dir) {
            if (_this.ftp instanceof ssh2_sftp_client_1.default) {
                return _this.ftp.put(f, dir).then(function () {
                    return Promise.resolve();
                });
            }
            else {
                return _this.ftp.put(f, dir).then(function () {
                    return Promise.resolve();
                });
            }
        };
        // Wrapper of this.ftp.connect to handle disparate returns of PromiseFtp and PromiseSftp
        _this.ftpConnect = function () {
            if (_this.ftp instanceof ssh2_sftp_client_1.default) {
                return _this.ftp.connect(_this.config).then(function (serverMessage) {
                    return Promise.resolve(serverMessage);
                });
            }
            else {
                return _this.ftp.connect(_this.config).then(function (serverMessage) {
                    return Promise.resolve(serverMessage);
                });
            }
        };
        _this.makeDir = function (newDirectory) {
            if (newDirectory === "/") {
                return Promise.resolve("unused");
            }
            else {
                return _this.ftp.mkdir(newDirectory, true);
            }
        };
        // Creates a remote directory and uploads all of the files in it
        // Resolves a confirmation message on success
        _this.makeAndUpload = function (relDir, fnames) {
            var _a;
            var newDirectory = upath_1.default.join(_this.config.remoteRoot, relDir);
            // @ts-ignore TODO
            return (_a = _this.makeDir(newDirectory)) === null || _a === void 0 ? void 0 : _a.then(function () {
                return bluebird_1.default.mapSeries(fnames, function (fname) {
                    var tmpFileName = upath_1.default.join(_this.config.localRoot, relDir, fname);
                    var tmp = fs_1.default.readFileSync(tmpFileName);
                    _this.eventObject["filename"] = upath_1.default.join(relDir, fname);
                    _this.emit("uploading", _this.eventObject);
                    return _this.ftpPut(tmp, upath_1.default.join(_this.config.remoteRoot, relDir, fname))
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
            if ("on" in _this.ftp) {
                _this.connectionStatus = "disconnected";
                _this.ftp.on("end", _this.handleDisconnect);
                _this.ftp.on("close", _this.handleDisconnect);
            }
            return _this.ftpConnect()
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
            return "getConnectionStatus" in _this.ftp &&
                typeof _this.ftp.getConnectionStatus === "function"
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
            return lib
                .checkIncludes(_this.config)
                .then(lib.getPassword)
                .then(_this.connect)
                .then(_this.deleteRemote)
                .then(_this.checkLocalAndUpload)
                .then(function (res) {
                console.log({ res: res });
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
        _this.ftp = _this.config.sftp ? new ssh2_sftp_client_1.default() : new promise_ftp_1.default();
        _this.eventObject = {
            totalFilesCount: 0,
            transferredFileCount: 0,
            filename: "",
        };
        _this.connectionStatus = "disconnected";
        return _this;
    }
    return FtpDeployer;
}(events_1.default.EventEmitter));
exports.default = FtpDeployer;
