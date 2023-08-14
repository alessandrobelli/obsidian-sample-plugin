import { Plugin, PluginSettingTab, Setting, App } from "obsidian";
import { TFolder, FuzzySuggestModal } from "obsidian";
const { fetchNotionData, extractContentFromPage } = require("./notionHandling");
const {
  createFolder,
  writeFilePromise,
  sanitizeTitle,
  downloadImage,
} = require("./utilities");
const { createMarkdownFiles } = require("./markdownCreation");
const fs = require("fs"); // If you're in an environment that supports require

class FolderSuggestModal extends FuzzySuggestModal<TFolder> {
  constructor(app: App, private callback: (folder: TFolder) => void) {
    super(app);
  }

  listAllDirectories(): TFolder[] {
    const vaultPath = this.app.vault.adapter.basePath;
    const directories = [];

    const items = fs.readdirSync(vaultPath, { withFileTypes: true });
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
}

const DEFAULT_SETTINGS: NotionMigrationSettings = {
  apiKey: "",
  databaseId: "",
  migrationPath: "",
  migrationLog: "",
};

export default class NotionMigrationPlugin extends Plugin {
  settings: NotionMigrationSettings;

  async onload() {
    await this.loadSettings();
    console.log("Loaded settings:", this.settings);
    this.addSettingTab(new NotionMigrationSettingTab(this.app, this));

    console.log("Notion to Obsidian Migration Plugin loaded!");
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
    // const files = app.vault.getFiles();

    // for (const file of files) {
    //   await app.vault.delete(file);
    // }

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
    let { containerEl } = this;

    containerEl.empty();
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

    containerEl.createEl("h3", { text: "Migration Log" });
    let logWindow = containerEl.createEl("textarea", {
      attr: {
        style:
          "width: 100%; height: 150px; margin-bottom: 10px; resize: none; cursor: pointer", // Added resize: none;
        readonly: "readonly", // Made the textarea readonly
      },
    });

    logWindow.value = this.plugin.settings.migrationLog; // Set the logWindow value to the saved log

    containerEl
      .createEl("button", {
        text: "Clear Log",
        cls: "mod-warning", // Using a warning style for the clear button
      })
      .addEventListener("click", () => {
        logWindow.value = "";
        this.plugin.settings.migrationLog = ""; // Clear the log in settings
      });

    let startButton = containerEl.createEl("button", {
      text: "Start Migration",

      cls: "mod-cta",
    });

    startButton.style.marginLeft = "10px";

    startButton.addEventListener("click", async () => {
      startButton.textContent = "Migrating..."; // Change button text
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

        wipeVaultAfterDelay(this.app);
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
          app
        );
        logMessage("Migration completed!");
      } catch (error) {
        logWindow.value += `Error: ${error.message}\n`;
      }
      startButton.textContent = "Start Migration";
      spinnerEl.remove();

      startButton.disabled = false;
    });
  }
}
