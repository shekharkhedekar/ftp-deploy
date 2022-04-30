"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.mkDirExists = exports.ftpMkdir = exports.deleteDir = exports.ftpList = exports.countFiles = exports.parseLocal = exports.canIncludePath = exports.getPassword = exports.checkIncludes = void 0;
var fs_1 = __importDefault(require("fs"));
var path_1 = __importDefault(require("path"));
var util_1 = __importDefault(require("util"));
var bluebird_1 = __importDefault(require("bluebird"));
var read_1 = __importDefault(require("read"));
var ssh2_sftp_client_1 = __importDefault(require("ssh2-sftp-client"));
var readP = util_1.default.promisify(read_1.default);
var minimatch_1 = __importDefault(require("minimatch"));
// P H A S E  0
function checkIncludes(config) {
    config.exclude = config.exclude || [];
    if (!config.include || !config.include.length) {
        return Promise.reject({
            code: "NoIncludes",
            message: "You need to specify files to upload - e.g. ['*', '**/*']",
        });
    }
    else {
        return Promise.resolve(config);
    }
}
exports.checkIncludes = checkIncludes;
function getPassword(config) {
    if (config.password) {
        return Promise.resolve(config);
    }
    else {
        var options = {
            prompt: "Password for " +
                config.user +
                "@" +
                config.host +
                " (ENTER for none): ",
            default: "",
            silent: true,
        };
        return readP(options).then(function (res) {
            var config2 = Object.assign(config, { password: res });
            return config2;
        });
    }
}
exports.getPassword = getPassword;
// Analysing local firstory
function canIncludePath(includes, excludes, filePath) {
    var go = function (acc, item) {
        return acc || (0, minimatch_1.default)(filePath, item, { matchBase: true });
    };
    var canInclude = includes.reduce(go, false);
    // Now check whether the file should in fact be specifically excluded
    if (canInclude) {
        // if any excludes match return false
        if (excludes) {
            var go2 = function (acc, item) {
                return acc && !(0, minimatch_1.default)(filePath, item, { matchBase: true });
            };
            canInclude = excludes.reduce(go2, true);
        }
    }
    return canInclude;
}
exports.canIncludePath = canIncludePath;
// A method for parsing the source location and storing the information into a suitably formated object
function parseLocal(includes, excludes, localRootDir, relDir) {
    // reducer
    var handleItem = function (acc, item) {
        var currItem = path_1.default.join(fullDir, item);
        var newRelDir = path_1.default.relative(localRootDir, currItem);
        if (fs_1.default.lstatSync(currItem).isDirectory()) {
            // currItem is a directory. Recurse and attach to accumulator
            var tmp = parseLocal(includes, excludes, localRootDir, newRelDir);
            for (var key in tmp) {
                if (tmp[key].length == 0) {
                    delete tmp[key];
                }
            }
            return Object.assign(acc, tmp);
        }
        else {
            // currItem is a file
            // acc[relDir] is always created at previous iteration
            if (canIncludePath(includes, excludes, newRelDir)) {
                acc[relDir].push(item);
                return acc;
            }
        }
        return acc;
    };
    var fullDir = path_1.default.join(localRootDir, relDir);
    // Check if `startDir` is a valid location
    if (!fs_1.default.existsSync(fullDir)) {
        throw new Error(fullDir + " is not an existing location");
    }
    // Iterate through the contents of the `fullDir` of the current iteration
    var files = fs_1.default.readdirSync(fullDir);
    // Add empty array, which may get overwritten by subsequent iterations
    var acc = {};
    acc[relDir] = [];
    var res = files.reduce(handleItem, acc);
    return res;
}
exports.parseLocal = parseLocal;
function countFiles(filemap) {
    return Object.values(filemap).reduce(function (acc, item) { return acc.concat(item); })
        .length;
}
exports.countFiles = countFiles;
// Wrapper for ftp.list to account for different return values of PromiseFtp and PromiseSftp
function ftpList(ftp, dir) {
    return new Promise(function (resolve, reject) {
        if (ftp instanceof ssh2_sftp_client_1.default) {
            ftp.list(dir)
                .then(function (lst) {
                resolve(lst);
            })
                .catch(function (err) { return reject(err); });
        }
        else {
            ftp.list(dir)
                .then(function (lst) {
                resolve(lst);
            })
                .catch(function (err) { return reject(err); });
        }
    });
}
exports.ftpList = ftpList;
function deleteDir(ftp, dir) {
    return ftpList(ftp, dir).then(function (lst) {
        var dirNames = lst
            .filter(function (f) {
            return f &&
                typeof f !== "string" &&
                f.type == "d" &&
                f.name != ".." &&
                f.name != ".";
        })
            .map(function (f) {
            return path_1.default.posix.join(dir, f.name);
        });
        var fnames = lst
            .filter(function (f) { return f && typeof f !== "string" && f.type != "d"; })
            .map(function (f) {
            return path_1.default.posix.join(dir, f.name);
        });
        // delete sub-directories and then all files
        return bluebird_1.default.mapSeries(dirNames, function (dirName) {
            // deletes everything in sub-directory, and then itself
            return deleteDir(ftp, dirName).then(function () {
                ftp.rmdir(dirName);
            });
        }).then(function () {
            return bluebird_1.default.mapSeries(fnames, function (fname) {
                ftp.delete(fname);
            });
        });
    });
}
exports.deleteDir = deleteDir;
// Wrapper for ftp.mkdir to account for different return values of PromiseFtp and PromiseSftp
var ftpMkdir = function (ftp, dir, recursive) {
    return new Promise(function (resolve, reject) {
        if (ftp instanceof ssh2_sftp_client_1.default) {
            ftp.mkdir(dir, recursive)
                .then(function () {
                resolve();
            })
                .catch(function (err) { return reject(err); });
        }
        else {
            ftp.mkdir(dir, true)
                .then(function () {
                resolve();
            })
                .catch(function (err) { return reject(err); });
        }
    });
};
exports.ftpMkdir = ftpMkdir;
var mkDirExists = function (ftp, dir) {
    // Make the directory using recursive expand
    return (0, exports.ftpMkdir)(ftp, dir, true).catch(function (err) {
        if (err.message.startsWith("EEXIST")) {
            return Promise.resolve();
        }
        else {
            return Promise.reject(err);
        }
    });
};
exports.mkDirExists = mkDirExists;
