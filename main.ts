import {App, FuzzySuggestModal, Plugin, PluginSettingTab, Setting, TFolder, SuggestModal} from "obsidian";
import {fetchNotionData, getDatabaseName} from "./notionHandling";
import {createMarkdownFiles} from "./markdownCreation";
import fs from "fs";
import tippy from 'tippy.js';
import {TextInputSuggest} from "./suggest";

export class FolderSuggest extends TextInputSuggest<TFolder> {
    getSuggestions(inputStr: string): TFolder[] {
        const abstractFiles = app.vault.getAllLoadedFiles();
        const folders: TFolder[] = [];
        const lowerCaseInputStr = inputStr.toLowerCase();

        abstractFiles.forEach((folder: TAbstractFile) => {
            if (
                folder instanceof TFolder &&
                folder.path.toLowerCase().contains(lowerCaseInputStr)
            ) {
                folders.push(folder);
            }
        });

        return folders;
    }

    renderSuggestion(file: TFolder, el: HTMLElement): void {
        el.setText(file.path);
    }

    selectSuggestion(file: TFolder): void {
        this.inputEl.value = file.path;
        this.inputEl.trigger("input");
        this.close();
    }
}

interface NotionMigrationSettings {
    apiKey: string;
    databaseId: string;
    migrationPath: string;
    migrationLog: string;
    attachPageId: boolean;
    importPageContent: boolean;
    isImporting: boolean;
    createRelationContentPage: boolean;
    enabledProperties: { [key: string]: boolean };
}

const DEFAULT_SETTINGS: NotionMigrationSettings = {
    apiKey: "",
    databaseId: "",
    migrationPath: "",
    migrationLog: "",
    attachPageId: false,
    importPageContent: true,
    isImporting: false,
    createRelationContentPage: true,
    enabledProperties: {},
};

export default class NotionMigrationPlugin extends Plugin {
    settings: NotionMigrationSettings;
    importControl = {
        isImporting: false
    };


    async onload() {
        await this.loadSettings();
        this.addSettingTab(new NotionMigrationSettingTab(this.app, this));


    }


    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }
}


class NotionMigrationSettingTab extends PluginSettingTab {
    plugin: NotionMigrationPlugin;

    constructor(app: App, plugin: NotionMigrationPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    private listAllDirectories(): TFolder[] {
        const vaultPath = this.app.vault.adapter.basePath;
        const directories = [];

        const items = fs.readdirSync(vaultPath, {withFileTypes: true});
        for (const item of items) {
            if (item.isDirectory()) {
                const folder = this.app.vault.getAbstractFileByPath(item.name);
                if (folder instanceof TFolder) {
                    directories.push(folder);
                }
            }
        }

        return directories;
    }


    // Declare a variable to hold the text input element for Database ID
    dbIdInput: HTMLInputElement;

    display(): void {

        const {containerEl} = this;
        containerEl.empty();
        let {logWindow, startButton, stopButton} = this.createUI(containerEl);

        if (this.plugin.settings.isImporting) {
            startButton.textContent = "Migrating...";
            startButton.disabled = true;
            stopButton.disabled = false;
            // Add a spinner or other visual indication if desired
        } else {
            startButton.textContent = "Start Migration";
            startButton.disabled = false;
            stopButton.disabled = true;
        }


        logWindow.value = this.plugin.settings.migrationLog; // Set the logWindow value to the saved log


        stopButton.disabled = !this.plugin.importControl.isImporting;

        startButton.addEventListener("click", async () => {
            const migrationPath = this.plugin.settings.migrationPath;


            // Check if the folder exists
            const folder = this.app.vault.getAbstractFileByPath(migrationPath);
            if (!folder || !(folder instanceof TFolder)) {
                logWindow.value += `Error: Folder "${migrationPath}" does not exist.\n`;
                return; // Return early if the folder doesn't exist
            }
            this.plugin.settings.isImporting = true;
            await this.plugin.saveSettings();
            this.plugin.importControl.isImporting = true;
            stopButton.disabled = false;
            startButton.textContent = "Migrating...";
            const spinnerEl = startButton.createEl("div");
            spinnerEl.style.marginLeft = "5px";
            spinnerEl.classList.add("spinner");
            startButton.appendChild(spinnerEl);

            startButton.disabled = true;
            try {
                const logMessage = (message) => {
                    logWindow.value += `${message}\n`;
                    logWindow.scrollTop = logWindow.scrollHeight;
                    this.plugin.settings.migrationLog = logWindow.value; // Store the log in settings
                    this.plugin.saveSettings();
                };

                //wipeVaultAfterDelay();
                const dbName = await getDatabaseName(this.plugin.settings.apiKey, this.plugin.settings.databaseId);
                if (dbName) {
                    logMessage(`Starting migration from Notion database: ${dbName}`);
                } else {
                    logMessage("Starting migration from Notion...");
                }
                // Fetch Notion data
                logMessage("Fetching data from Notion...");
                const allPages = await fetchNotionData(
                    this.plugin.settings.databaseId,
                    this.plugin.settings.apiKey
                );
                logMessage(`${allPages.length} items fetched from Notion.`);

                // Create markdown files
                logMessage("Creating markdown files...");
                await createMarkdownFiles(
                    allPages,
                    this.plugin.settings.migrationPath,
                    this.plugin.settings.apiKey,
                    this.app,
                    this.plugin.settings.attachPageId,
                    this.plugin.settings.importPageContent,
                    this.plugin.importControl,
                    logMessage,
                    this.plugin.settings.createRelationContentPage,
                    this.plugin.settings.enabledProperties
                );
                logMessage("Migration completed!");
            } catch (error) {
                logWindow.value += `Error: ${error.message}\n`;
            }
            startButton.textContent = "Start Migration";
            spinnerEl.remove();

            this.plugin.settings.isImporting = false;
            await this.plugin.saveSettings();
            startButton.disabled = false;
        });

        stopButton.addEventListener("click", async () => {
            this.plugin.settings.isImporting = false; // Set isImporting to false in settings
            this.plugin.importControl.isImporting = false; // Set isImporting to false in importControl
            await this.plugin.saveSettings();

            stopButton.disabled = true; // Disable stop button
            startButton.textContent = "Start Migration"; // Update start button text
        });

    }


    async displayPageList() {
        const apiKey = this.plugin.settings.apiKey; // Replace with the actual API key retrieval logic
        const query = ''; // Empty query to search for all pages

        const requestOptions = {
            method: 'POST',
            url: 'https://api.notion.com/v1/search',
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'Notion-Version': '2022-06-28',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                query: query, filter: {
                    value: 'database',
                    property: 'object',
                },
            }),
        };


        try {
            const response = await request(requestOptions);
            const responseData = JSON.parse(response);

            const container = document.getElementById('page-list-container');
            container.innerHTML = ''; // Clear previous content

            const buttonContainer = container.createDiv({
                cls: 'hide-button-container',
                attr: {
                    style: 'margin-top: 10px; margin-bottom: 10px;display: flex; justify-content: space-between;'
                }
            });
            console.log(responseData);
            // Add "Hide" button
            const hideButton = buttonContainer.createEl('button', {text: 'Hide'});
            hideButton.addEventListener('click', () => {
                tableWrapper.style.display = tableWrapper.style.display === 'none' ? 'block' : 'none';
            });
            const hideButtonDbs = buttonContainer.createEl('button', {text: 'Hide DBs'});

            // Add a message next to the "Hide" button
            const messageSpan = buttonContainer.createEl('span', {
                text: 'Click on the row to update database ID. Hover to check properties.',
                attr: {}
            });

            // Create a scrollable wrapper for the table
            const tableWrapper = container.createEl('div', {
                attr: {style: 'max-height: 350px; overflow-y: auto;'}
            });

            const table = tableWrapper.createEl('table', {
                attr: {style: 'width: 100%; border-collapse: collapse;position: relative'}
            });

            hideButtonDbs.addEventListener('click', () => {
                table.style.display = table.style.display === 'none' ? 'block' : 'none';
            });
            // Table header
            const thead = table.createEl('thead');
            const headerRow = thead.createEl('tr');
            headerRow.createEl('th', {text: 'Page Name', attr: {style: 'padding: 10px; border: 1px solid #ccc;'}});
            headerRow.createEl('th', {text: 'Page ID', attr: {style: 'padding: 10px; border: 1px solid #ccc;'}});

            // Table body with clickable rows
            const tbody = table.createEl('tbody');


            for (const page of responseData.results) {
                const pageName = page.title && page.title[0] && page.title[0].plain_text
                    ? page.title[0].plain_text
                    : ''; // Use empty string if undefined
                const row = tbody.createEl('tr');
                row.createEl('td', {text: pageName, attr: {style: 'padding: 10px; border: 1px solid #ccc;'}});
                row.createEl('td', {text: page.id, attr: {style: 'padding: 10px; border: 1px solid #ccc;'}});

                // Create a tooltip for the row
                let propertiesText = "<strong>Properties</strong> <br>";
                for (const [key, value] of Object.entries(page.properties || {})) {
                    propertiesText += `${key} - ${value.type} <br>`;
                }
                tippy(row, {
                    content: propertiesText,
                    allowHTML: true,
                    theme: 'light',
                    delay: 100,  // Delay in showing tooltip
                    arrow: true,  // Show the arrow
                    duration: [300, 200],  // Duration of show/hide animations
                });

                // Existing row click event code
                row.addEventListener('click', async () => {


                    // Create a loading indicator
                    const loadingIndicator = document.createElement('div');
                    loadingIndicator.innerHTML = 'Loading properties...';
                    loadingIndicator.style.position = 'absolute';
                    loadingIndicator.style.top = '50%';
                    loadingIndicator.style.left = '50%';
                    loadingIndicator.style.transform = 'translate(-50%, -50%)';
                    loadingIndicator.style.zIndex = '10';
                    loadingIndicator.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
                    loadingIndicator.style.color = 'white';
                    loadingIndicator.style.padding = '15px';
                    loadingIndicator.style.borderRadius = '5px';

                    // Add the loading indicator to the table wrapper
                    tableWrapper.appendChild(loadingIndicator);
                    this.plugin.settings.databaseId = page.id;
                    if (this.dbIdInput) {
                        this.dbIdInput.value = page.id;
                    }
                    await this.plugin.saveSettings();
                    this.plugin.settings.enabledProperties = {};

                    // Fetch properties for the clicked database
                    const allPages = await fetchNotionData(page.id, this.plugin.settings.apiKey);

                    // Remove the loading indicator
                    tableWrapper.removeChild(loadingIndicator);
                    if (allPages.length > 0) {
                        // Assume all pages have the same properties and take the properties of the first page as an example
                        const exampleProperties = allPages[0].properties;

                        // Remove any existing properties table
                        const existingPropertiesTable = document.getElementById('properties-table');
                        if (existingPropertiesTable) {
                            existingPropertiesTable.remove();
                        }

                        // Create a new properties table
                        const propertiesTable = tableWrapper.createEl('table', {
                            attr: {
                                id: 'properties-table',
                                style: 'width: 100%; border-collapse: collapse; margin-top: 20px;'
                            }
                        });

                        const propertiesThead = propertiesTable.createEl('thead');
                        const propertiesHeaderRow = propertiesThead.createEl('tr');
                        propertiesHeaderRow.createEl('th', {
                            text: 'Name',
                            attr: {style: 'padding: 10px; border: 1px solid #ccc;'}
                        });
                        propertiesHeaderRow.createEl('th', {
                            text: 'Type',
                            attr: {style: 'padding: 10px; border: 1px solid #ccc;'}
                        });
                        propertiesHeaderRow.createEl('th', {
                            text: 'Import',
                            attr: {style: 'padding: 10px; border: 1px solid #ccc;'}
                        });

                        const propertiesTbody = propertiesTable.createEl('tbody');
                        for (const [key, value] of Object.entries(exampleProperties)) {
                            const propertyRow = propertiesTbody.createEl('tr');
                            propertyRow.createEl('td', {
                                text: key,
                                attr: {style: 'padding: 10px; border: 1px solid #ccc;'}
                            });
                            propertyRow.createEl('td', {
                                text: value.type,
                                attr: {style: 'padding: 10px; border: 1px solid #ccc;'}
                            });
                            const checkboxCell = propertyRow.createEl('td', {attr: {style: 'padding: 10px; border: 1px solid #ccc;'}});
                            const checkbox = checkboxCell.createEl('input', {
                                attr: {
                                    type: 'checkbox',
                                    checked: this.plugin.settings.enabledProperties[key] ?? true  // Default to true
                                }
                            });

                            // Listen for changes to each checkbox
                            checkbox.addEventListener('change', async (event) => {
                                const isChecked = (event.target as HTMLInputElement).checked;
                                this.plugin.settings.enabledProperties[key] = isChecked;
                                await this.plugin.saveSettings();
                            });
                        }
                    }
                });


            }
        } catch (error) {
            console.error('Error fetching data:', error);
        }
    }


    private createUI(containerEl: HTMLElement) {

        containerEl.createEl("h1", {
            text: "Notion to Obsidian Migration Settings",
        });

        new Setting(containerEl)
            .setName("Notion API Key")
            .setDesc("Enter your Notion API key here.")
            .addText((text) =>
                text.setValue(this.plugin.settings.apiKey).onChange(async (value) => {
                    this.plugin.settings.apiKey = value;
                    await this.plugin.saveSettings();
                })
            ).addButton(button => button
            .setButtonText("Search DBs")
            .setCta()
            .onClick(() => {
                this.displayPageList();
            })
        );
// Placeholder for the page list table
        containerEl.createDiv({
            attr: {id: 'page-list-container'}
        });

        new Setting(containerEl)
            .setName("Database ID")
            .setDesc("Enter your Notion Database ID here.")
            .addText((text) => {
                this.dbIdInput = text.inputEl;
                text
                    .setValue(this.plugin.settings.databaseId)
                    .onChange(async (value) => {
                        this.plugin.settings.databaseId = value;
                        await this.plugin.saveSettings();
                    })
            });

        new Setting(containerEl)
            .setName("Migration Path")
            .addText((text) => {
                text.setValue(this.plugin.settings.migrationPath)
                    .onChange(async (value) => {
                        this.plugin.settings.migrationPath = value;
                        await this.plugin.saveSettings();
                    });

                new FolderSuggest(text.inputEl); // Initialize FolderSuggest
            });
        new Setting(containerEl)
            .setName("Create relations also inside the page")
            .setDesc("By default you can't link notes inside properties, so we can also insert relations inside the page")
            .addToggle(toggle =>
                toggle
                    .setValue(this.plugin.settings.createRelationContentPage)
                    .onChange(async value => {
                        this.plugin.settings.createRelationContentPage = value;
                        await this.plugin.saveSettings();
                    })
            );


        new Setting(containerEl)
            .setName("Attach page ID at the end")
            .setDesc("Necessary if you have pages with the same name in Notion.")
            .addToggle(toggle =>
                toggle
                    .setValue(this.plugin.settings.attachPageId)
                    .onChange(async value => {
                        this.plugin.settings.attachPageId = value;
                        await this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName("Import page content")
            .setDesc("Choose whether to import the content of the pages from Notion.")
            .addToggle(toggle =>
                toggle
                    .setValue(this.plugin.settings.importPageContent)
                    .onChange(async value => {
                        this.plugin.settings.importPageContent = value;
                        await this.plugin.saveSettings();
                    })
            );


        containerEl.createEl("h3", {text: "Migration Log"});
        const logWindow = containerEl.createEl("textarea", {
            attr: {
                style:
                    "width: 100%; height: 150px; margin-bottom: 10px; resize: none; cursor: pointer", // Added resize: none;
                readonly: "readonly", // Made the textarea readonly
            },
        }), buttonContainer = containerEl.createDiv({
            cls: 'button-container',
            attr: {
                style: 'margin-top: 20px; display: flex; justify-content: space-between;'
            }
        }), startButton = buttonContainer.createEl("button", {
            text: "Start Migration",
            cls: ["mod-cta", "start-button"],
        }), stopButton = buttonContainer.createEl("button", {
            text: "Stop Migration",
            cls: ["mod-warning", "stop-button"],
            attr: {
                style: 'margin-left: 10px'
            }
        });
        buttonContainer
            .createEl("button", {
                text: "Clear Log",
                cls: "mod-warning", // Using a warning style for the clear button
            })
            .addEventListener("click", () => {
                logWindow.value = "";
                this.plugin.settings.migrationLog = ""; // Clear the log in settings
                this.plugin.saveSettings();
            });
        return {logWindow, startButton, stopButton};
    }


}
