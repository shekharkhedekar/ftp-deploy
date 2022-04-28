import upath from "upath";
import events from "events";
import Bluebird from "bluebird";
import fs from "fs";
import {
    CheckLocalAndUploadFunc,
    Config,
    ConnectFunc,
    DeleteRemoteFunc,
    DeployFunc,
    FileMap,
    GetConnectionStatusFunc,
    HandleDisconnectFunc,
    MakeAllAndUploadFunc,
    MakeAndUploadFunc,
    MakeDirFunc,
    UploadResponse,
} from "./types";

import PromiseFtp from "promise-ftp";
import PromiseSftp from "ssh2-sftp-client";

import * as lib from "./lib";

class FtpDeployer extends events.EventEmitter {
    config: Config;
    ftp: PromiseFtp | PromiseSftp;
    eventObject: {
        totalFilesCount: number;
        transferredFileCount: number;
        filename: string;
        error?: Error;
    };
    connectionStatus: "disconnected" | "connected";

    constructor(config: Config) {
        super();

        this.config = config;
        this.ftp = this.config.sftp ? new PromiseSftp() : new PromiseFtp();
        this.eventObject = {
            totalFilesCount: 0,
            transferredFileCount: 0,
            filename: "",
        };
        this.connectionStatus = "disconnected";
    }

    makeAllAndUpload: MakeAllAndUploadFunc = (filemap: FileMap) => {
        let keys = Object.keys(filemap);
        return Bluebird.mapSeries(keys, (key) => {
            return this.makeAndUpload(key, filemap[key]);
        });
    };

    makeDir: MakeDirFunc = (newDirectory) => {
        if (newDirectory === "/") {
            return Promise.resolve("unused");
        } else {
            return this.ftp.mkdir(newDirectory, true);
        }
    };
    // Creates a remote directory and uploads all of the files in it
    // Resolves a confirmation message on success
    makeAndUpload: MakeAndUploadFunc = (relDir, fnames) => {
        let newDirectory = upath.join(this.config.remoteRoot, relDir);
        // @ts-ignore TODO
        return this.makeDir(newDirectory)?.then(() => {
            return Bluebird.mapSeries(fnames, (fname) => {
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
                    .catch((err: Error) => {
                        this.eventObject["error"] = err;
                        this.emit("upload-error", this.eventObject);
                        // if continue on error....
                        return Promise.reject(err);
                    });
            });
        });
    };

    // connects to the server, Resolves the config on success
    connect: ConnectFunc = () => {
        // sftp client does not provide a connection status
        // so instead provide one ourselfs
        if ("on" in this.ftp) {
            this.connectionStatus = "disconnected";
            this.ftp.on("end", this.handleDisconnect);
            this.ftp.on("close", this.handleDisconnect);
        }

        return this.ftp
            .connect(this.config)
            .then((serverMessage: string) => {
                this.emit("log", "Connected to: " + this.config.host);
                this.emit("log", "Connected: Server message: " + serverMessage);

                // sftp does not provide a connection status
                // so instead provide one ourself
                if (this.config.sftp) {
                    this.connectionStatus = "connected";
                }

                return this.config;
            })
            .catch((err: { code: number; message: string }) => {
                return Promise.reject({
                    code: err.code,
                    message: "connect: " + err.message,
                });
            });
    };

    getConnectionStatus: GetConnectionStatusFunc = () => {
        // only ftp client provides connection status
        // sftp client connection status is handled using events
        return "getConnectionStatus" in this.ftp &&
            typeof this.ftp.getConnectionStatus === "function"
            ? this.ftp.getConnectionStatus()
            : this.connectionStatus;
    };

    handleDisconnect: HandleDisconnectFunc = () => {
        this.connectionStatus = "disconnected";
    };

    // creates list of all files to upload and starts upload process
    checkLocalAndUpload: CheckLocalAndUploadFunc = () => {
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
    deleteRemote: DeleteRemoteFunc = () => {
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
                .catch((err: Error) => {
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

    deploy: DeployFunc = (cb) => {
        return lib
            .checkIncludes(this.config)
            .then(lib.getPassword)
            .then(this.connect)
            .then(this.deleteRemote)
            .then(this.checkLocalAndUpload)
            .then((res) => {
                console.log({ res });
                this.ftp.end();
                if (typeof cb == "function") {
                    cb(null, res);
                } else {
                    return Promise.resolve(res);
                }
            })
            .catch((err: Error) => {
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

export default FtpDeployer;
