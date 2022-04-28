import * as Promise from "bluebird";
import PromiseFtp from "promise-ftp";
import PromiseSftp from "ssh2-sftp-client";
import { SFTPWrapper } from "ssh2";
import events from "events";

export interface Config extends PromiseSftp.ConnectOptions {
    deleteRemote?: boolean;
    exclude: string[];
    include: string[];
    localRoot: string;
    remoteRoot: string;
    sftp?: boolean;
    user: string;
}

export type ConnectionStatus = "disconnected" | "connected";

export type FileMap = { [key: string]: string[] };

export type Ftp = PromiseFtp | PromiseSftp | null;

export interface EventObject {
    totalFilesCount: number;
    transferredFileCount: number;
    filename: string;
    error?: Error;
}

export type MakeAllAndUploadFunc = (
    filemap: FileMap
) => globalThis.Promise<void[]> | Promise<void[]>;

export type MakeDirFunc = (
    newDirectory: string
) => globalThis.Promise<string> | Promise<string> | Promise<void> | undefined;

export type MakeAndUploadFunc = (
    relDir: string,
    fnames: string[]
) => globalThis.Promise<void> | Promise<void>;

export type ConnectFunc = () =>
    | globalThis.Promise<Config>
    | Promise<Config>
    | undefined;

export type GetConnectionStatusFunc = () => string;

export type HandleDisconnectFunc = () => void;

export type CheckLocalAndUploadFunc = () => PromiseLike<void | void[]>;

export type DeleteRemoteFunc = () => Config;

export type UploadResponse = string[][];

export type DeployFunc = (
    cb: (err: Error | null, res: void | void[] | null) => void
) => void;

export type FtpPutFunc = (f: Buffer, dir: string) => globalThis.Promise<void>;

export type FtpConnectFunc = () => globalThis.Promise<string | SFTPWrapper>;

export interface ConnectionError extends Error {
    code: number;
    message: string;
}
