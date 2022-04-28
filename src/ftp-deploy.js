"use strict";

const upath = require("upath");
const util = require("util");
const events = require("events");
const Promise = require("bluebird");
const fs = require("fs");

var PromiseFtp = require("promise-ftp");
var PromiseSftp = require("ssh2-sftp-client");
const lib = require("./lib");

/* interim structure
{
    '/': ['test-inside-root.txt'],
    'folderA': ['test-inside-a.txt'],
    'folderA/folderB': ['test-inside-b.txt'],
    'folderA/folderB/emptyC': [],
    'folderA/folderB/emptyC/folderD': ['test-inside-d-1.txt', 'test-inside-d-2.txt']
}
*/

class FtpDeployer {
    constructor(config) {
        // The constructor for the super class.
        events.EventEmitter.call(this);
        this.config = config;
        this.ftp = this.config.sftp ? new PromiseSftp() : new PromiseFtp();
        this.eventObject = {
            totalFilesCount: 0,
            transferredFileCount: 0,
            filename: "",
        };
    }

    makeAllAndUpload = function (filemap) {
        let keys = Object.keys(filemap);
        return Promise.mapSeries(keys, (key) => {
            return this.makeAndUpload(key, filemap[key]);
        });
    };

    makeDir = function (newDirectory) {
        if (newDirectory === "/") {
            return Promise.resolve("unused");
        } else {
            return this.ftp.mkdir(newDirectory, true);
        }
    };
    // Creates a remote directory and uploads all of the files in it
    // Resolves a confirmation message on success
    makeAndUpload = function (relDir, fnames) {
        let newDirectory = upath.join(this.config.remoteRoot, relDir);
        return this.makeDir(newDirectory, true).then(() => {
            return Promise.mapSeries(fnames, (fname) => {
                let tmpFileName = upath.join(
                    this.config.localRoot,
                    relDir,
                    fname
                );
                let tmp = fs.readFileSync(tmpFileName);
                this.eventObject["filename"] = upath.join(relDir, fname);

                this.emit("uploading", this.eventObject);

                return this.ftp
                    .put(tmp, upath.join(this.config.remoteRoot, relDir, fname))
                    .then(() => {
                        this.eventObject.transferredFileCount++;
                        this.emit("uploaded", this.eventObject);
                        return Promise.resolve("uploaded " + tmpFileName);
                    })
                    .catch((err) => {
                        this.eventObject["error"] = err;
                        this.emit("upload-error", this.eventObject);
                        // if continue on error....
                        return Promise.reject(err);
                    });
            });
        });
    };

    // connects to the server, Resolves the config on success
    connect = () => {
        // sftp client does not provide a connection status
        // so instead provide one ourselfs
        if (this.config.sftp) {
            this.connectionStatus = "disconnected";
            this.ftp.on("end", this.handleDisconnect);
            this.ftp.on("close", this.handleDisconnect);
        }

        return this.ftp
            .connect(this.config)
            .then((serverMessage) => {
                this.emit("log", "Connected to: " + this.config.host);
                this.emit("log", "Connected: Server message: " + serverMessage);

                // sftp does not provide a connection status
                // so instead provide one ourself
                if (this.config.sftp) {
                    this.connectionStatus = "connected";
                }

                return this.config;
            })
            .catch((err) => {
                return Promise.reject({
                    code: err.code,
                    message: "connect: " + err.message,
                });
            });
    };

    getConnectionStatus = () => {
        // only ftp client provides connection status
        // sftp client connection status is handled using events
        return typeof this.ftp.getConnectionStatus === "function"
            ? this.ftp.getConnectionStatus()
            : this.connectionStatus;
    };

    handleDisconnect = () => {
        this.connectionStatus = "disconnected";
    };

    // creates list of all files to upload and starts upload process
    checkLocalAndUpload = () => {
        try {
            let filemap = lib.parseLocal(
                this.config.include,
                this.config.exclude,
                this.config.localRoot,
                "/"
            );

            this.emit(
                "log",
                "Files found to upload: " + JSON.stringify(filemap)
            );
            this.eventObject["totalFilesCount"] = lib.countFiles(filemap);

            return this.makeAllAndUpload(filemap);
        } catch (e) {
            return Promise.reject(e);
        }
    };

    // Deletes remote directory if requested by config
    // Returns config
    deleteRemote = () => {
        if (this.config.deleteRemote) {
            return lib
                .deleteDir(this.ftp, this.config.remoteRoot)
                .then(() => {
                    this.emit(
                        "log",
                        "Deleted directory: " + this.config.remoteRoot
                    );
                    return this.config;
                })
                .catch((err) => {
                    this.emit(
                        "log",
                        "Deleting failed, trying to continue: " +
                            JSON.stringify(err)
                    );
                    return Promise.resolve(this.config);
                });
        }
        return Promise.resolve(this.config);
    };

    deploy = function (cb) {
        return lib
            .checkIncludes(this.config)
            .then(lib.getPassword)
            .then(this.connect)
            .then(this.deleteRemote)
            .then(this.checkLocalAndUpload)
            .then((res) => {
                this.ftp.end();
                if (typeof cb == "function") {
                    cb(null, res);
                } else {
                    return Promise.resolve(res);
                }
            })
            .catch((err) => {
                if (this.ftp && this.getConnectionStatus() != "disconnected")
                    this.ftp.end();
                if (typeof cb == "function") {
                    cb(err, null);
                } else {
                    return Promise.reject(err);
                }
            });
    };
}

util.inherits(FtpDeployer, events.EventEmitter);

module.exports = FtpDeployer;
