import { createHash } from "node:crypto";
import { closeSync, openSync, readSync, statSync } from "node:fs";
import { isTextPath } from "./project.js";
const CHUNK = 1024 * 1024;
/**
 * Fast file fingerprint: size + sha256 of the first and last 1 MB.
 * Files up to 2 MB are hashed in full. Never uses mtime (git checkouts reset it).
 * Text files are hashed with LF line endings, so CRLF and LF checkouts (git autocrlf)
 * of the same file agree. Unreadable or locked files return undefined, never throw.
 */
export function fingerprint(absPath) {
    let size;
    try {
        const st = statSync(absPath);
        if (!st.isFile())
            return undefined;
        size = st.size;
    }
    catch {
        return undefined;
    }
    let fd;
    try {
        fd = openSync(absPath, "r");
        if (size <= 2 * CHUNK) {
            let buf = Buffer.alloc(size);
            readSync(fd, buf, 0, size, 0);
            if (isTextPath(absPath.replace(/\\/g, "/")) && buf.includes(13)) {
                buf = Buffer.from(buf.toString("utf8").replace(/\r\n/g, "\n"), "utf8");
                size = buf.length;
            }
            return `${size}:${createHash("sha256").update(buf).digest("hex").slice(0, 16)}`;
        }
        const h = createHash("sha256");
        const buf = Buffer.alloc(CHUNK);
        readSync(fd, buf, 0, CHUNK, 0);
        h.update(buf);
        readSync(fd, buf, 0, CHUNK, size - CHUNK);
        h.update(buf);
        return `${size}:${h.digest("hex").slice(0, 16)}`;
    }
    catch {
        return undefined;
    }
    finally {
        if (fd !== undefined) {
            try {
                closeSync(fd);
            }
            catch {
                // ignore
            }
        }
    }
}
export function hashText(s) {
    return createHash("sha256").update(s).digest("hex").slice(0, 12);
}
export function fileSize(fp) {
    if (!fp)
        return undefined;
    const n = Number(fp.split(":")[0]);
    return Number.isFinite(n) ? n : undefined;
}
