import {moment, request} from "obsidian";
import {extractContentFromPage} from "./notionHandling";
import {downloadFile, sanitizeTitle, writeFilePromise, generateUniqueTitle} from "./utilities";
import path from "path";

async function createMarkdownFiles(allPages, folderName, apiKey, app, attachPageId, importPageContent, importControl, logMessage, createRelationContentPage, enabledProperties, createSemanticLinking, attachmentPath, squashDateNamesForDataview) {
	const promises = [];
	const vaultPath = app.vault.adapter.basePath; // Get the base path of the Obsidian vault
    let pageTitle = "";
	for (const page of allPages) {
		let relationLinks = [];
		let relationSemanticLinks = [];
		if (!importControl.isImporting) {
			logMessage("Import halted by user.");
			break; // Exit the loop if import has been halted
		}
		let title = "empty";
		for (const [key, property] of Object.entries(page.properties)) {

			if (property.title && property.title[0]) {
				title = property.title[0].plain_text;
				title = sanitizeTitle(title);


				break;
			}
		}
		// Append the Notion page ID to the title to ensure uniqueness
		if (attachPageId) title = `${title}_${page.id}`;
		else title = generateUniqueTitle(title, `${vaultPath}/${folderName}`);

		let content = `---\n`;


		for (const [key, property] of Object.entries(page.properties)) {


			if (enabledProperties[key] === false) {
				continue;
			}


			const safeKey = (key) => (/[^\w\s]/.test(key) ? `"${key}"` : key);
			const safeValue = (value) => (/[\W_]/.test(value) ? `"${value}"` : value);

			switch (property.type) {
				case "select":
					if (property.select) {
						content += `${safeKey(key)}: ${safeValue(property.select.name)}\n`;
					}
					break;
				case "rich_text":
					if (property.rich_text && property.rich_text.length) {
						const textContent = property.rich_text
							.map((text) => text.plain_text)
							.join("")
							.replace(/\n/g, ' '); // Replacing newline characters with spaces
						content += `${safeKey(key)}: >-\n  ${safeValue(textContent)}\n`;
					} else {
						content += `${safeKey(key)}: null\n`;
					}

					break;
				case "checkbox":
					content += `${safeKey(key)}: ${property.checkbox ? 'true' : 'false'}\n`;
					break;
				case "date":
					let finalKey = key;
					if (squashDateNamesForDataview) {
						finalKey = key.split(" ").map(word => word.charAt(0).toUpperCase() + word.slice(1)).join("");
					}

					if (property.date && property.date.start) {
						let newDate = moment
							.utc(property.date.start)
							.toISOString();
						content += `${safeKey(finalKey)}: ${newDate}\n`;
					} else {
						content += `${safeKey(finalKey)}: null\n`;
					}
					break;

				case "number":
					if (property.number) {
						content += `${safeKey(key)}: ${property.number}\n`;
					} else {
						content += `${safeKey(key)}: \n`;
					}
					break;
				case "status":
					if (property.status && property.status.name) {
						content += `${safeKey(key)}: ${safeValue(property.status.name)}\n`;
					} else {
						content += `${safeKey(key)}: \n`;
					}
					break;
				case "multi_select":
					if (property.multi_select && property.multi_select.length) {
						const tags = property.multi_select
							.map((tag) => `${tag.name}`)
							.join(" ");
						content += `${safeKey(key)}: ${tags}\n`;
					}
					break;
				case "files":
					const files = property.files; // Access the files array

					// Iterate through the files and download each one
					for (const file of files) {
						const fileUrl = file.external.url; // Access the URL
						const fileExtension = getFileExtension(fileUrl); // Get the file extension

						// Use attachmentPath here
						const outputPath = path.join(
							attachmentPath,
							`file_${Date.now()}.${fileExtension}`
						); // Define the desired output path

						try {
							await downloadFile(fileUrl, outputPath, app);
							content += `[[${path.basename(outputPath)}]]\n`; // Link ing the downloaded file
						} catch (error) {
							console.error("Failed to download and link the file:", error);
						}
					}
					break;

				case "formula":
					let formulaType = property.formula.type;
					let formulaValue = ""


					switch (formulaType) {
						case "number":
							formulaValue = property.formula.number;
							content += `${safeKey(key)}: ${formulaValue}\n`;
							break;

						case "string":
							formulaValue = property.formula.string;
							content += `${safeKey(key)}: ${formulaValue}\n`;
							break;
						case "boolean":
							// Handle boolean formula
							content += `${safeKey(key)}: ${property.formula.boolean}\n`;
							break;

						default:
							console.warn(`Unknown formula type: ${formulaType}`);
							break;
					}
					break;
				case "created_time":
					if (property.created_time) {
						let createdDate = moment.utc(property.created_time).toISOString();
						content += `${safeKey(key)}: ${createdDate}\n`;
					} else {
						content += `${safeKey(key)}: \n`;
					}
					break;
				case "relation":
					if (property.relation && property.relation.length) {
						const requestHeaders = {
							Authorization: `Bearer ${apiKey}`,
							"Notion-Version": "2022-06-28",
							"Content-Type": "application/json",
						};

						let relatedNames = [];
						for (const rel of property.relation) {
							const pageId = rel.id;
							const response = await request({
								url: `https://api.notion.com/v1/pages/${pageId}`,
								method: "GET",
								headers: requestHeaders,
							});
							const pageData = JSON.parse(response);
							const pageName = pageData.properties.Name.title[0].plain_text;
							relatedNames.push(pageName);
						}

						// Semantic Linking part
						if (createSemanticLinking) {
							const safeKeyWithUnderscores = safeKey(key).replace(/ /g, '_');
							const semanticLink = `${safeKeyWithUnderscores}:: ${relatedNames.map(name => `[[${name}]]`).join(", ")}\n`;
							relationSemanticLinks.push(semanticLink);
						}

						if (createRelationContentPage) {
							// Create relation in YAML list format
							content += `${safeKey(key)}:\n${relatedNames.map(name => `  - [[${name}]]`).join("\n")}\n`;
							relationLinks.push(`${safeKey(key)}: ${relatedNames.map(name => `[[${name}]]`)}\n`);
						} else {
							// Create relation in YAML list format
							content += `${safeKey(key)}:\n${relatedNames.map(name => `  - ${name}`).join("\n")}\n`;
						}
					} else {
						content += `${safeKey(key)}: \n`;
					}
					break;


				case "url":
					if (property.url) {
						content += `${safeKey(key)}: ${property.url}\n`;
					} else {
						content += `${safeKey(key)}: \n`;
					}
					break;

				case "rollup":
					const rollupArray = property.rollup ? property.rollup.array : null; // Check if rollup is defined

					if (Array.isArray(rollupArray)) {
						rollupArray.forEach(rollupItem => {
							switch (rollupItem.type) {
								case "formula":
									switch (rollupItem.formula.type) {
										case "string":
											// Handle string formula inside rollup
											content += `${safeKey(key)}: ${safeValue(rollupItem.formula.string)}\n`;
											break;
										case "boolean":
											// Handle boolean formula
											content += `${safeKey(key)}: ${rollupItem.formula.boolean}\n`;
											break;
										case "number":
											if (rollupItem.function === "percent_per_group") {
												const numberValue = rollupItem.number;
												content += `${safeKey(key)}: ${numberValue}\n`;
											}
											break;

										default:
											// Handle other or unknown formula types inside rollup
											console.log(rollupItem.type + " not handled");
											break;
									}
									break;
							}
						});
					} else {
						content += `${safeKey(key)}: null\n`; // Handle case when rollupArray is not defined
					}
					break;


				case "title":
					if (property.title && property.title[0]) {
						const keyWithUnderscores = property.title[0].plain_text.replace(/ /g, '_');
						const finalKey = safeKey(keyWithUnderscores);
						pageTitle = finalKey;
						content += `Alias: ${finalKey}\n`;
					} else {
						content += `Alias: \n`;
					}
					break;

				default:
					console.log(property.type + " not defined");

					break;

			}

		}
		content += `---\n`;
		if (relationLinks.length > 0) content += relationLinks;
		if (relationSemanticLinks.length > 0) content += relationSemanticLinks;

		if (importPageContent) {
			try {
				await extractContentFromPage(
					page.id,
					pageTitle,
					apiKey,
					attachmentPath,
					vaultPath
				).then((result) => content += result);
			} catch (error) {
				console.error('Error in extractContentFromPage:', error);
			}


		}
		console.log(
			"Writing file: " + `${vaultPath}/${folderName}/${title}.md`
		);

		promises.push(
			writeFilePromise(`${vaultPath}/${folderName}/${title}.md`, content)
		);
		console.log(
			"File written: " + `${vaultPath}/${folderName}/${title}.md`
		);
	}
	await Promise.all(promises);
}

// Function to get the file extension from the URL
function getFileExtension(url) {
	const urlObj = new URL(url);
	const pathname = urlObj.pathname;
	return pathname.split(".").pop() || "";
}


module.exports = {
	createMarkdownFiles,
};
