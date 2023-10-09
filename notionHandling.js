import {request} from "obsidian";
import path from "path";
import {downloadFile, getImageExtension, writeFilePromise} from "./utilities";


async function getDatabaseName(apiKey, databaseId) {
	const requestHeaders = {
		Authorization: `Bearer ${apiKey}`, "Notion-Version": "2022-06-28", "Content-Type": "application/json",
	};

	try {
		const response = await request({
			url: `https://api.notion.com/v1/databases/${databaseId}`, method: "GET", headers: requestHeaders,
		});

		const data = JSON.parse(response);
		return data.title[0].plain_text;  // Extracting the database name from the response
	} catch (error) {
		console.error("Error fetching database name:", error);
		return null;  // Return null if there's an error
	}
}


async function fetchNotionData(databaseId, apiKey) {
	const requestHeaders = {
		Authorization: `Bearer ${apiKey}`, "Notion-Version": "2022-06-28", "Content-Type": "application/json",
	};

	let results = [];
	let hasMore = true;
	let startCursor = null;

	while (hasMore) {
		const requestBody = startCursor ? {start_cursor: startCursor} : {};

		const response = await request({
			url: `https://api.notion.com/v1/databases/${databaseId}/query`,
			method: "POST",
			headers: requestHeaders,
			body: JSON.stringify(requestBody),
		});

		const data = JSON.parse(response);

		results.push(...data.results);

		hasMore = data.has_more;
		startCursor = data.next_cursor;
	}

	return results;
}

async function fetchBlockContent(blocks, previousBlockType, numberCounter, content, attachmentPath, apiKey, pageName, fileCounter, vaultPath, safeKey, promises) {
	for (const block of blocks.results) {
		// Reset the numbered list counter if the block type changes
		if (previousBlockType === 'numbered_list_item' && block.type !== 'numbered_list_item') {
			numberCounter = 1;
		}
		switch (block.type) {
			case "rich_text":
				if (block.rich_text && block.rich_text.length) {
					content += `${block.rich_text
						.map((text) => text.plain_text)
						.join("")}\n\n`;
				}
				break;
			case "paragraph":
				if (block.paragraph && block.paragraph.rich_text && block.paragraph.rich_text.length) {
					let paragraphContent = "";
					for (const richTextElement of block.paragraph.rich_text) {
						if (richTextElement.type === "text") {
							if (richTextElement.href) {
								paragraphContent += `[${richTextElement.plain_text}](${richTextElement.href})`;
							} else {
								paragraphContent += richTextElement.plain_text;
							}
						}
						else if (richTextElement.type === "mention" && richTextElement.mention.type === "date") {
							const originalDate = new Date(richTextElement.plain_text);
							const formattedDate = `${originalDate.getDate()}.${originalDate.getMonth() + 1}.${originalDate.getFullYear()}`;
							paragraphContent += `[[${formattedDate}]]`; // Date formatted as DD.MM.YYYY
						} else {
							// Handle other types as needed
							console.log("Unhandled rich text type: " + richTextElement.type)
						}
					}
					content += `${paragraphContent}\n\n`;
				}
				break;

			case "heading_1":
			case "heading_2":
			case "heading_3":
				if (block[block.type] && block[block.type].rich_text && block[block.type].rich_text.length) {
					const heading = `#`.repeat(Number(block.type.split("_")[1]));
					let headingContent = "";
					for (const richTextElement of block[block.type].rich_text) {
						let text = richTextElement.plain_text;
						if (richTextElement.annotations.bold) {
							text = `**${text}**`;
						}
						if (richTextElement.annotations.italic) {
							text = `*${text}*`;
						}
						headingContent += text;
					}
					content += `${heading} ${headingContent}\n\n`;
				}
				break;


			case "bulleted_list_item":
			case "numbered_list_item":
				if (block[block.type] && block[block.type].rich_text && block[block.type].rich_text.length) {
					const prefix = block.type === "bulleted_list_item" ? "-" : `${numberCounter}.`;

					// Increment the number counter if it's a numbered list item
					if (block.type === "numbered_list_item") {
						numberCounter++;
					}

					let listItemContent = "";
					for (const richTextElement of block[block.type].rich_text) {
						let textContent = richTextElement.plain_text;

						// Apply bold formatting if needed
						if (richTextElement.annotations.bold) {
							textContent = `**${textContent}**`;
						}

						// Apply italic formatting if needed
						if (richTextElement.annotations.italic) {
							textContent = `*${textContent}*`;
						}

						listItemContent += textContent;
					}

					content += `${prefix} ${listItemContent}\n`;
				}
				break;

			case "image":
				if (block.image && block.image.external && block.image.external.url) {
					// Handle external images
					content += `!()[${path.basename(imagePath)}]\n\n`;
				}else if (block.image && block.image.file && block.image.file.url) {
					// Handle images uploaded to Notion
					const imageUrl = block.image.file.url;
					const fileExtension = getImageExtension(imageUrl);
					const imagePath = path.join(attachmentPath, // Use attachmentPath here
						`image_${Date.now()}.${fileExtension}`);
					await downloadFile(imageUrl, imagePath, app, apiKey); // Assuming app and apiKey are available
					content += `![[${path.basename(imagePath)}]]\n\n`;
				}
				break;
			case "to_do":
				if (block.to_do && block.to_do.rich_text && block.to_do.rich_text.length) {
					const checkbox = block.to_do.checked ? "[x]" : "[ ]";
					let todoContent = "";
					for (const richTextElement of block.to_do.rich_text) {
						let textContent = richTextElement.plain_text;
						if (richTextElement.annotations.bold) {
							textContent = `**${textContent}**`;
						}
						if (richTextElement.annotations.italic) {
							textContent = `*${textContent}*`;
						}
						todoContent += textContent;
					}
					content += `${checkbox} ${todoContent}\n`;
				}
				break;
			case "table":
				if (block.table && block.table.headers && block.table.rows) {
					content += "| " + block.table.headers.join(" | ") + " |\n";
					content += "| " + new Array(block.table.headers.length)
						.fill("---")
						.join(" | ") + " |\n";
					block.table.rows.forEach((row) => {
						content += "| " + row.join(" | ") + " |\n";
					});
				}
				break;
			case "code":
				if (block.code && block.code.rich_text && block.code.rich_text.length) {
					let codeContent = block.code.rich_text.map((text) => text.plain_text).join("");
					const language = block.code.language ? block.code.language : "";
					content += `\`\`\`${language}\n${codeContent}\n\`\`\`\n\n`;
				}
				break;

			case "link_preview":
				if (block.link_preview && block.link_preview.url) {
					const linkUrl = block.link_preview.url;
					content += `[Link Preview](${linkUrl})\n\n`;
				}
				break;

			case "toggle":
				if (block.toggle && block.toggle.rich_text && block.toggle.rich_text.length) {
					let toggleContent = "";
					for (const richTextElement of block.toggle.rich_text) {
						let textContent = richTextElement.plain_text;
						toggleContent += textContent;
					}
					content += `> [!NOTE]+ ${toggleContent} \n`;
				}
				break;

			case "video":
				if (block.video && block.video.type === "external" && block.video.external.url) {
					const videoUrl = block.video.external.url;
					content += `Video: [${videoUrl}](${videoUrl})\n\n`;
				}
				break;
			case "audio":
				if (block.audio && block.audio.file && block.audio.file.url) {
					const audioUrl = block.audio.file.url;
					const audioExtension = path.extname(new URL(audioUrl).pathname);
					const audioFileName = `${pageName}_${fileCounter}${audioExtension}`;
					const audioFilePath = path.join(attachmentPath, // Use attachmentPath here
						audioFileName);
					await downloadFile(audioUrl, audioFilePath, app, apiKey);  // Assuming app and apiKey are available

					content += `![[${path.basename(audioFilePath)}]]\n\n`;  // Or however you want to reference the audio file

					// Increment the file counter
					fileCounter++;
				}
				break;
			case "file":
				if (block.file && block.file.file && block.file.file.url) {
					const fileUrl = block.file.file.url;
					const fileExtension = path.extname(new URL(fileUrl).pathname);
					const fileName = `${pageName}_${fileCounter}${fileExtension}`;
					const filePath = path.join(attachmentPath, fileName);
					await downloadFile(fileUrl, filePath, app, apiKey);

					content += `![[${path.basename(filePath)}]]\n\n`;

					// Increment the file counter
					fileCounter++;
				} else if (block.external && block.external.url) {
					const externalUrl = block.external.url;
					content += `[[${externalUrl}]]\n\n`; // Adjusted format for external links as well
				}
				break;
			case "bookmark":
				if (block.bookmark && block.bookmark.url) {
					let titleText = block.bookmark.caption
						.map((text) => text.plain_text)
						.join("");
					titleText = titleText || block.bookmark.url;
					const bookmarkUrl = block.bookmark.url;
					content += `[${titleText}](${bookmarkUrl})\n\n`;
				}
				break;
			case "child_page":
				if (block.child_page && block.child_page.title) {
					const childPageTitle = block.child_page.title;
					const childPageId = block.id;

					// Make a recursive call to fetch the content of the child page
					const childContent = await extractContentFromPage(childPageId, childPageTitle, apiKey, attachmentPath, vaultPath);

					// Prepare the path to save the subpage in the /subpages folder
					const subpagePath = `${vaultPath}/subpages/${safeKey(childPageTitle)}.md`;

					// Log and push to promises array
					console.log("Writing sub file: " + subpagePath);
					promises.push(writeFilePromise(subpagePath, childContent));
					console.log("Sub File written: " + subpagePath);

					// Link the subpage in the parent page content
					content += `[[${childPageTitle}]]\n\n`;
				}
				break;
		}
		// Update the previous block type
		previousBlockType = block.type;

		if (block.has_children) {
			console.log(`=== Fetching children for block ID: ${block.id} ===`);  // Very visible console.log message

			// Fetch children of the block
			const childBlocksResponse = await request({
				url: `https://api.notion.com/v1/blocks/${block.id}/children`,
				method: "GET",
				headers: {
					'Authorization': `Bearer ${apiKey}`,
					'Notion-Version': '2022-06-28'
				}
			});
			const childBlocks = JSON.parse(childBlocksResponse);

			// Recursively get the content for child blocks
			const childContent = await fetchBlockContent({results: childBlocks.results}, previousBlockType, numberCounter, "", attachmentPath, apiKey, pageName, fileCounter, vaultPath, safeKey, promises);

			// Add ">" at the start of each line if the block is a "toggle" type
			if (block.type === "toggle") {
				const indentedChildContent = childContent.split("\n").map(line => "> " + line).join("\n");
				content += indentedChildContent;
			} else {
				content += childContent;
			}
		}
	}


	return content;
}

async function extractContentFromPage(pageId, pageName, apiKey, attachmentPath, vaultPath) {
	const requestHeaders = {
		Authorization: `Bearer ${apiKey}`, "Notion-Version": "2022-06-28", "Content-Type": "application/json",
	};


	const safeKey = (key) => (/[^\w\s]/.test(key) ? `"${key}"` : key);
	const safeValue = (value) => (/[\W_]/.test(value) ? `"${value}"` : value);


	const response = await request({
		url: `https://api.notion.com/v1/blocks/${pageId}/children`, method: "GET", headers: requestHeaders,
	});

	const blocks = JSON.parse(response);
	console.log('API Response:', JSON.stringify(blocks, null, 2));
	const promises = [];
	let content = "";
	let numberCounter = 1;
	let fileCounter = 1;
	let previousBlockType = null;  // Keep track of the previous block type
	content = await fetchBlockContent(blocks, previousBlockType, numberCounter, content, attachmentPath, apiKey, pageName, fileCounter, vaultPath, safeKey, promises);

	await Promise.all(promises);
	return content;
}

module.exports = {
	fetchNotionData, extractContentFromPage, getDatabaseName
};
