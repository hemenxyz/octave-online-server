"use strict";

const async = require("async");
const fs = require("fs");
const path = require("path");
const mime = require("mime");
const charsetDetector = require("node-icu-charset-detector");
const Iconv = require("iconv").Iconv;
const logger = require("@oo/shared").logger;
const config = require("@oo/shared").config;

// Load extra MIME types
mime.load(path.join(__dirname, "mime.types"));

const ACCEPTABLE_MIME_REGEX = /^(text\/.*)$/;
const UNACCEPTABLE_FILENAME_REGEX = /^(\..*|octave-\w+)$/;

class WorkingUtil {
	constructor(workDir, logMemo) {
		this._log = logger(`working-util:${logMemo}`);
		this.cwd = workDir;
	}

	listAll(next) {
		async.waterfall([
			(_next) => {
				fs.readdir(this.cwd, _next);
			},
			(files, _next) => {
				async.map(files, this.getFileInfo.bind(this), _next);
			},
			(fileInfos, _next) => {
				const dict = {};
				fileInfos.forEach((fileInfo) => {
					if (!fileInfo) return;
					let filename = fileInfo.filename;
					delete fileInfo.filename;
					dict[filename] = fileInfo;
				});
				_next(null, dict);
			}
		], next);
	}

	getFileInfo(filename, next) {
		const _mime = mime.lookup(filename);
		if (ACCEPTABLE_MIME_REGEX.test(_mime)) {
			async.waterfall([
				(_next) => {
					fs.stat(path.join(this.cwd, filename), _next);
				},
				(stats, _next) => {
					if (stats.size > config.session.textFileSizeLimit) {
						// This file is too big.  Do not perform any further processing on this file.
						// FIXME: Show a nice message to the end user to let them know why their file isn't being loaded
						this._log.debug("Skipping text file that is too big:", stats.size, filename);
						return next(null, {
							filename,
							isText: false
						});
					}

					// The file is small.  Continue processing.
					fs.readFile(path.join(this.cwd, filename), _next);
				},
				(buf, _next) => {
					this._convertCharset(buf, _next)
				},
				(buf, _next) => {
					_next(null, {
						filename,
						isText: true,
						content: buf.toString("base64")
					});
				}
			], next);
		} else if (!UNACCEPTABLE_FILENAME_REGEX.test(filename)) {
			return next(null, {
				filename,
				isText: false
			});
		} else {
			return next(null, null);
		}
	}

	_convertCharset(buf, next) {
		var encoding;

		// Detect and attempt to convert charset
		if (buf.length > 0) {
			try {
				encoding = charsetDetector.detectCharset(buf);
				if (encoding.toString() !== "UTF-8"){
					buf = new Iconv(encoding.toString(), "UTF-8").convert(buf);
				}
			} catch(err) {
				this._log.warn("Could not convert encoding:", encoding);
			}
		}

		// Convert line endings
		// TODO: Is there a better way than converting to a string here?
		buf = new Buffer(buf.toString("utf8").replace(/\r\n/g, "\n"));

		return next(null, buf);
	}

	saveFile(filename, value, next) {
		// Create backup of file in memory in case there are any I/O errors
		async.waterfall([
			(_next) => {
				fs.readFile(
					path.join(this.cwd, filename),
						(err, buf) => {
						if (!err) return _next(null, buf);
						if (/ENOENT/.test(err.message)) {
							this._log.info("Creating new file:", filename);
							return _next(null, new Buffer(0));
						}
						return _next(err);
					});
			},
			(buf, _next) => {
				fs.writeFile(
					path.join(this.cwd, filename),
					value,
					(err) => {
						_next(null, buf, err);
					});
			},
			(buf, err, _next) => {
				if (err) {
					fs.writeFile(
						path.join(this.cwd, filename),
						buf,
						() => {
							_next(err);
						});
				} else {
					async.nextTick(() => {
						_next(null);
					});
				}
			}
		], next);
	}

	renameFile(oldname, newname, next) {
		fs.rename(
			path.join(this.cwd, oldname),
			path.join(this.cwd, newname),
			next);
	}

	deleteFile(filename, next) {
		fs.unlink(
			path.join(this.cwd, filename),
			next);
	}

	readBinary(filename, next) {
		async.waterfall([
			(_next) => {
				fs.readFile(path.join(this.cwd, filename), _next);
			},
			(buf, _next) => {
				const base64data = buf.toString("base64");
				const _mime = mime.lookup(filename);
				_next(null, base64data, _mime);
			}
		], next);
	}
}

module.exports = WorkingUtil;
