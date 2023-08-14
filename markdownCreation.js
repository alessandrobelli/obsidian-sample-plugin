const { extractContentFromPage } = require("./notionHandling");
const { writeFilePromise, sanitizeTitle } = require("./utilities");

async function createMarkdownFiles(allPages, folderName, apiKey, app) {
	const promises = [];
	const vaultPath = app.vault.adapter.basePath; // Get the base path of the Obsidian vault

	for (const page of allPages) {
		let title = "empty";
		for (const [key, property] of Object.entries(page.properties)) {
			if (property.title && property.title[0]) {
				title = property.title[0].plain_text;
				title = sanitizeTitle(title);

				break;
			}
		}
		// Append the Notion page ID to the title to ensure uniqueness
		title = `${title}_${page.id}`;
		let content = `---\n`;
		for (const [key, property] of Object.entries(page.properties)) {
			switch (property.type) {
				case "select":
					if (property.select) {
						content += `${key}: ${property.select.name}\n`;
					}
					break;
				case "url":
					content += `${key}: ${property.url}\n`;
					break;
				case "rich_text":
					if (block.rich_text && block.rich_text.length) {
						const textContent = block.rich_text
							.map((text) => text.plain_text)
							.join("");
						content += `${textContent}\n\n`;
					}

					break;
				case "checkbox":
					if (property.checkbox) {
						content += `${key}: True\n`;
					} else {
						content += `${key}: False\n`;
					}
					break;
				case "date":
					if (property.date && property.date.start) {
						let newDate = moment
							.utc(property.date.start)
							.toISOString();
						content += `${key}: ${newDate}\n`;
					} else {
						content += `${key}: \n`;
					}
					break;
				case "number":
					if (property.number) {
						content += `${key}: ${property.number}\n`;
					} else {
						content += `${key}: \n`;
					}
				case "multi_select":
					if (property.multi_select && property.multi_select.length) {
						const tags = property.multi_select
							.map((tag) => `${tag.name}`)
							.join(" ");
						content += `${key}: ${tags}\n`;
					}
					break;
			}
		}
		content += `---\n`;
		const pageContent = await extractContentFromPage(
			page.id,
			folderName,
			apiKey
		);
		content += pageContent;
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

module.exports = {
	createMarkdownFiles,
};
