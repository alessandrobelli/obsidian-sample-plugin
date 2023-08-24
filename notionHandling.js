import {request} from "obsidian";
import path from "path";
import {downloadFile, getImageExtension} from "./utilities";


async function getDatabaseName(apiKey, databaseId) {
    const requestHeaders = {
        Authorization: `Bearer ${apiKey}`,
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json",
    };

    try {
        const response = await request({
            url: `https://api.notion.com/v1/databases/${databaseId}`,
            method: "GET",
            headers: requestHeaders,
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
		Authorization: `Bearer ${apiKey}`,
		"Notion-Version": "2022-06-28",
		"Content-Type": "application/json",
	};

	let results = [];
	let hasMore = true;
	let startCursor = null;

	while (hasMore) {
		const requestBody = startCursor ? { start_cursor: startCursor } : {};

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

async function extractContentFromPage(pageId, folderName, apiKey) {
	const requestHeaders = {
		Authorization: `Bearer ${apiKey}`,
		"Notion-Version": "2022-06-28",
		"Content-Type": "application/json",
	};

	const response = await request({
		url: `https://api.notion.com/v1/blocks/${pageId}/children`,
		method: "GET",
		headers: requestHeaders,
	});

	const blocks = JSON.parse(response);
	let content = "";
	for (const block of blocks.results) {
		switch (block.type) {
			case "rich_text":
				if (block.rich_text && block.rich_text.length) {
					content += `${block.rich_text
						.map((text) => text.plain_text)
						.join("")}\n\n`;
				}
				break;
			case "paragraph":
				if (
					block.paragraph &&
					block.paragraph.text &&
					block.paragraph.text.length
				) {
					content += `${block.paragraph.text
						.map((t) => t.plain_text)
						.join("")}\n\n`;
				}
				break;
			case "heading_1":
			case "heading_2":
			case "heading_3":
				if (
					block[block.type] &&
					block[block.type].text &&
					block[block.type].text.length
				) {
					const heading = `#`.repeat(
						Number(block.type.split("_")[1])
					);
					content += `${heading} ${block[block.type].text
						.map((t) => t.plain_text)
						.join("")}\n\n`;
				}
				break;
			case "bulleted_list_item":
			case "numbered_list_item":
				if (
					block[block.type] &&
					block[block.type].text &&
					block[block.type].text.length
				) {
					const prefix =
						block.type === "bulleted_list_item" ? `-` : `1.`;
					content += `${prefix} ${block[block.type].text
						.map((t) => t.plain_text)
						.join("")}\n`;
				}
				break;
			case "image":
				if (
					block.image &&
					block.image.external &&
					block.image.external.url
				) {
					const imageUrl = block.image.external.url;
					const fileExtension = getImageExtension(imageUrl);
					const imagePath = path.join(
						folderName,
						`image_${Date.now()}.${fileExtension}`
					);
					await downloadFile(imageUrl, imagePath, app, apiKey);
					content += `![[${path.basename(imagePath)}]]\n\n`;
				}
				break;
			case "to_do":
				if (
					block.to_do &&
					block.to_do.text &&
					block.to_do.text.length
				) {
					const checkbox = block.to_do.checked ? "[x]" : "[ ]";
					content += `${checkbox} ${block.to_do.text
						.map((t) => t.plain_text)
						.join("")}\n`;
				}
				break;
			case "table":
				if (block.table && block.table.headers && block.table.rows) {
					content += "| " + block.table.headers.join(" | ") + " |\n";
					content +=
						"| " +
						new Array(block.table.headers.length)
							.fill("---")
							.join(" | ") +
						" |\n";
					block.table.rows.forEach((row) => {
						content += "| " + row.join(" | ") + " |\n";
					});
				}
				break;
			case "file":
				if (block.file && block.file.file && block.file.file.url) {
					const fileUrl = block.file.file.url;
					const fileExtension = path.extname(
						new URL(fileUrl).pathname
					);
					const filePath = path.join(
						folderName,
						`file_${Date.now()}${fileExtension}`
					);
					await downloadFile(fileUrl, filePath, app, apiKey);
					content += `![[${path.basename(filePath)}]]\n\n`;
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
		}
	}

	return content;
}

module.exports = {
	fetchNotionData,
	extractContentFromPage,
	getDatabaseName
};
