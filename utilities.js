const { requestUrl } = require("obsidian");

const fs = require("fs");
const moment = require("moment");
const axios = require("axios");
const path = require("path");

async function downloadImage(url, folderName, app) {
	const vaultPath = app.vault.adapter.basePath;

	const response = await axios.get(url, {
		responseType: "arraybuffer",
	});

	const filename = path.join(vaultPath, folderName, path.basename(url));
	fs.writeFileSync(filename, response.data);

	return filename;
}

const createFolder = async (app) => {
	const vaultPath = app.vault.adapter.basePath;

	const folderName = moment().format("YYYY-MM-DD-HH-mm-ss");
	return new Promise((resolve, reject) => {
		fs.mkdir(path.join(vaultPath, folderName), (err) => {
			if (err) {
				reject(err);
			}
			resolve(folderName);
		});
	});
};

async function downloadFile(url, outputPath, app) {
	const vaultPath = app.vault.adapter.basePath;

	try {
		const response = await requestUrl({
			url: url,
			method: "GET",
			headers: {
				"Content-Type": "application/octet-stream",
			},
			mode: "no-cors",
			cache: "default",
		});

		console.log("Received response:", response);

		if (!response) {
			throw new Error(`Failed to download file.`);
		} else {
			console.log("response", response);
		}

		// Convert the response to an ArrayBuffer
		const arrayBuffer = await response.arrayBuffer;

		// Write the ArrayBuffer to the filesystem
		fs.writeFileSync(
			path.join(vaultPath, outputPath),
			new Uint8Array(arrayBuffer)
		);
	} catch (error) {
		console.error("Error in downloadFile:", error);
		throw error;
	}
}

const getImageExtension = (url) => {
	const extensionMatch = url.match(/\.(jpeg|jpg|gif|png)/);
	return extensionMatch ? extensionMatch[1] : "png";
};

const sanitizeTitle = (title) => {
	// Remove special characters and limit length
	return title
		.replace(/[^a-zA-Z0-9-_ ]/g, "")
		.replace(/ /g, "_")
		.substring(0, 200);
};

const writeFilePromise = (fileName, content) => {
	return new Promise((resolve, reject) => {
		fs.writeFile(fileName, content, function (err) {
			if (err) {
				console.error(`Error writing file ${fileName}: ${err}`);
				reject(err);
			} else {
				resolve(`${fileName} was saved!`);
			}
		});
	});
};

module.exports = {
	downloadImage,
	createFolder,
	downloadFile,
	getImageExtension,
	sanitizeTitle,
	writeFilePromise,
};
