import fs from "fs";
import path from "path";
import util from "util";
import Bluebird, { reject } from "bluebird";
import read from "read";
import PromiseSftp, { FileInfo } from "ssh2-sftp-client";

const readP = util.promisify(read);

import minimatch from "minimatch";
import { Config, FileMap, Ftp } from "./types";
import { ListingElement } from "promise-ftp";

// P H A S E  0
export function checkIncludes(config: Config): Promise<Config> {
    config.exclude = config.exclude || [];
    if (!config.include || !config.include.length) {
        return Promise.reject({
            code: "NoIncludes",
            message: "You need to specify files to upload - e.g. ['*', '**/*']",
        });
    } else {
        return Promise.resolve(config);
    }
}

export function getPassword(
    config: Config
): Promise<
    Config | (Config & { password: string }) | (Config & { password: string })
> {
    if (config.password) {
        return Promise.resolve(config);
    } else {
        let options = {
            prompt:
                "Password for " +
                config.user +
                "@" +
                config.host +
                " (ENTER for none): ",
            default: "",
            silent: true,
        };
        return readP(options).then((res) => {
            let config2 = Object.assign(config, { password: res });
            return config2;
        });
    }
}

// Analysing local firstory
export function canIncludePath(
    includes: string[],
    excludes: string[],
    filePath: string
): boolean {
    let go = (acc: boolean, item: string) =>
        acc || minimatch(filePath, item, { matchBase: true });
    let canInclude = includes.reduce(go, false);

    // Now check whether the file should in fact be specifically excluded
    if (canInclude) {
        // if any excludes match return false
        if (excludes) {
            let go2 = (acc: boolean, item: string) =>
                acc && !minimatch(filePath, item, { matchBase: true });
            canInclude = excludes.reduce(go2, true);
        }
    }

    return canInclude;
}

type StringArrayRecord = { [key: string]: string[] };
// A method for parsing the source location and storing the information into a suitably formated object
export function parseLocal(
    includes: string[],
    excludes: string[],
    localRootDir: string,
    relDir: string
): StringArrayRecord {
    // reducer
    let handleItem = function (acc: StringArrayRecord, item: string) {
        const currItem = path.join(fullDir, item);
        const newRelDir = path.relative(localRootDir, currItem);

        if (fs.lstatSync(currItem).isDirectory()) {
            // currItem is a directory. Recurse and attach to accumulator
            let tmp = parseLocal(includes, excludes, localRootDir, newRelDir);
            for (let key in tmp) {
                if (tmp[key].length == 0) {
                    delete tmp[key];
                }
            }
            return Object.assign(acc, tmp);
        } else {
            // currItem is a file
            // acc[relDir] is always created at previous iteration
            if (canIncludePath(includes, excludes, newRelDir)) {
                acc[relDir].push(item);
                return acc;
            }
        }
        return acc;
    };

    const fullDir = path.join(localRootDir, relDir);
    // Check if `startDir` is a valid location
    if (!fs.existsSync(fullDir)) {
        throw new Error(fullDir + " is not an existing location");
    }

    // Iterate through the contents of the `fullDir` of the current iteration
    const files = fs.readdirSync(fullDir);
    // Add empty array, which may get overwritten by subsequent iterations
    let acc: StringArrayRecord = {};
    acc[relDir] = [];
    const res = files.reduce(handleItem, acc);
    return res;
}

export function countFiles(filemap: FileMap): number {
    return Object.values(filemap).reduce((acc, item) => acc.concat(item))
        .length;
}

// Wrapper for ftp.list to account for different return values of PromiseFtp and PromiseSftp
export function ftpList(
    ftp: Ftp,
    dir: string
): Promise<(string | void | FileInfo | ListingElement)[]> {
    return new Promise((resolve, reject) => {
        if (ftp instanceof PromiseSftp) {
            ftp.list(dir)
                .then((lst) => {
                    resolve(lst);
                })
                .catch((err) => reject(err));
        } else {
            ftp.list(dir)
                .then((lst) => {
                    resolve(lst);
                })
                .catch((err) => reject(err));
        }
    });
}

export function deleteDir(ftp: Ftp, dir: string): Promise<any> {
    return ftpList(ftp, dir).then((lst) => {
        let dirNames = lst
            .filter(
                (f) =>
                    f &&
                    typeof f !== "string" &&
                    f.type == "d" &&
                    f.name != ".." &&
                    f.name != "."
            )
            .map((f) =>
                path.posix.join(dir, (f as FileInfo | ListingElement).name)
            );

        let fnames = lst
            .filter((f) => f && typeof f !== "string" && f.type != "d")
            .map((f) =>
                path.posix.join(dir, (f as FileInfo | ListingElement).name)
            );

        // delete sub-directories and then all files
        return Bluebird.mapSeries(dirNames, (dirName) => {
            // deletes everything in sub-directory, and then itself
            return deleteDir(ftp, dirName).then(() => {
                ftp.rmdir(dirName);
            });
        }).then(() =>
            Bluebird.mapSeries(fnames, (fname) => {
                ftp.delete(fname);
            })
        );
    });
}

// Wrapper for ftp.mkdir to account for different return values of PromiseFtp and PromiseSftp
export const ftpMkdir = (
    ftp: Ftp,
    dir: string,
    recursive?: boolean
): Promise<void> => {
    return new Promise((resolve, reject) => {
        if (ftp instanceof PromiseSftp) {
            ftp.mkdir(dir, recursive)
                .then(() => {
                    resolve();
                })
                .catch((err) => reject(err));
        } else {
            ftp.mkdir(dir, true)
                .then(() => {
                    resolve();
                })
                .catch((err) => reject(err));
        }
    });
};

export const mkDirExists = (ftp: Ftp, dir: string) => {
    // Make the directory using recursive expand
    return ftpMkdir(ftp, dir, true).catch((err) => {
        if (err.message.startsWith("EEXIST")) {
            return Promise.resolve();
        } else {
            return Promise.reject(err);
        }
    });
};
