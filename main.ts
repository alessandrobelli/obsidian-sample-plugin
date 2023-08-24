import {App, FuzzySuggestModal, Plugin, PluginSettingTab, Setting, TFolder} from "obsidian";
import {fetchNotionData, getDatabaseName} from "./notionHandling";
import {createMarkdownFiles} from "./markdownCreation";
import fs from "fs";


class FolderSuggestModal extends FuzzySuggestModal<TFolder> {
    constructor(app: App, private callback: (folder: TFolder) => void) {
        super(app);
    }

    listAllDirectories(): TFolder[] {
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

    getAllFolders(): TFolder[] {
        return this.listAllDirectories();
    }

    getItems(): TFolder[] {
        return this.getAllFolders();
    }

    getItemText(item: TFolder): string {
        return item.path;
    }

    onChooseItem(item: TFolder, evt: MouseEvent | KeyboardEvent): void {
        evt.preventDefault();
        this.callback(item);
        this.modalEl.remove();
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
}

const DEFAULT_SETTINGS: NotionMigrationSettings = {
    apiKey: "",
    databaseId: "",
    migrationPath: "",
    migrationLog: "",
    attachPageId: false,
    importPageContent: true,
    isImporting: false,
    createRelationContentPage: true
};

export default class NotionMigrationPlugin extends Plugin {
    settings: NotionMigrationSettings;
    importControl = {
        isImporting: false
    };

    addHoverStyles() {
        const style = document.createElement('style');
        style.innerHTML = `
        .start-button:not(:disabled):hover,
        .stop-button:not(:disabled):hover {
            opacity: 0.5;
        }
    `;
        document.head.appendChild(style);
    }

    async onload() {
        await this.loadSettings();
        this.addSettingTab(new NotionMigrationSettingTab(this.app, this));
        // Add CSS for the hover effect
        this.addHoverStyles();

    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }
}

// Function to wipe the vault after a delay
async function wipeVaultAfterDelay(app) {
    setTimeout(async () => {
        const files = app.vault.getFiles();

        for (const file of files) {
            await app.vault.delete(file);
        }

        console.log("All files are not deleted, enable this!");
    }, 1000); // 5 seconds delay
}

class NotionMigrationSettingTab extends PluginSettingTab {
    plugin: NotionMigrationPlugin;

    constructor(app: App, plugin: NotionMigrationPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

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


        startButton.style.marginLeft = "10px";

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
                    app,
                    this.plugin.settings.attachPageId,
                    this.plugin.settings.importPageContent,
                    this.plugin.importControl,
                    logMessage,
                    this.plugin.settings.createRelationContentPage
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
            );

        new Setting(containerEl)
            .setName("Database ID")
            .setDesc("Enter your Notion Database ID here.")
            .addText((text) =>
                text
                    .setValue(this.plugin.settings.databaseId)
                    .onChange(async (value) => {
                        this.plugin.settings.databaseId = value;
                        await this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl).setName("Migration Path").addText((text) => {
            let fromSuggestion = false; // Add this flag

            text
                .setPlaceholder("Choose or type a folder name inside your vault")
                .setValue(this.plugin.settings.migrationPath)
                .onChange(async (value) => {
                    this.plugin.settings.migrationPath = value;
                    await this.plugin.saveSettings();
                });

            // Open the suggest modal when the input field is focused
            text.inputEl.addEventListener("focus", () => {
                if (fromSuggestion) {
                    // Check the flag here
                    fromSuggestion = false; // Reset the flag
                    return;
                }
                new FolderSuggestModal(this.app, async (folder) => {
                    fromSuggestion = true; // Set the flag to true when a suggestion is chosen
                    text.setValue(folder.path);
                    this.plugin.settings.migrationPath = folder.path;
                    await this.plugin.saveSettings(); // Explicitly save settings after setting the value
                }).open();
            });
        });
        new Setting(containerEl)
            .setName("Create relations inside the page")
            .setDesc("By default you can't link notes inside properties, so we can insert relations inside the page")
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
