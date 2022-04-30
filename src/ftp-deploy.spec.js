"use strict";

const path = require("path");
const fs = require("fs");
const utils = require("util");
const del = require("delete");

const FtpDeploy = require("./ftp-deploy").default;

const statP = utils.promisify(fs.stat);

const config = {
    user: "anonymous",
    password: "anon", // Optional, prompted if none given
    host: "localhost",
    port: 2121,
    localRoot: path.join(__dirname, "../test/local"),
    remoteRoot: "/ftp",
    exclude: [],
    include: ["folderA/**/*", "test-inside-root.txt"],
    debugMode: true,
};

describe("ftp-deploy.spec: deploy tests", () => {
    const remoteDir = path.join(__dirname, "../test/remote/ftp");

    it("should fail if badly configured", () => {
        const configError = Object.assign({}, config, { port: 212 });
        const d = new FtpDeploy(configError);
        return del(remoteDir)
            .then(() => {
                return d.deploy();
            })
            .catch((err) => {
                // Should reject if file does not exist
                if (err.code === "ECONNREFUSED") {
                    return Promise.resolve("got expected error");
                } else {
                    return Promise.reject(err);
                }
            });
    });
    it("should fail with no include", () => {
        let c2 = Object.assign({}, config, { include: [] });
        const d = new FtpDeploy(c2);
        return del(remoteDir)
            .then(() => {
                return d.deploy();
            })
            .catch((err) => {
                if (err.code === "NoIncludes") {
                    return Promise.resolve("got expected error");
                } else {
                    return Promise.reject(err);
                }
            });
    });
    it("should put a file", () => {
        const d = new FtpDeploy(config);
        return del(remoteDir)
            .then(() => {
                return d.deploy();
            })
            .then(() => {
                // Should reject if file does not exist
                return statP(remoteDir + "/test-inside-root.txt");
            })
            .catch((err) => Promise.reject(err));
    });
    it("should put a dot file", () => {
        config.include = [".*"];
        const d = new FtpDeploy(config);
        return del(remoteDir)
            .then(() => {
                return d.deploy();
            })
            .then(() => {
                // Should reject if file does not exist
                return statP(remoteDir + "/.testfile");
            })
            .catch((err) => Promise.reject(err));
    });
});
