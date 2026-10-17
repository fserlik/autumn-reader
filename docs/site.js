(function () {
  const root = document.documentElement;
  const themeButton = document.querySelector(".theme-toggle");
  const storedTheme = localStorage.getItem("autumn-theme");
  const preferredTheme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";

  function setTheme(theme) {
    const dark = theme === "dark";
    root.dataset.theme = theme;
    if (themeButton) {
      themeButton.setAttribute("aria-pressed", String(dark));
      themeButton.setAttribute("aria-label", dark ? "Use light theme" : "Use dark theme");
    }
  }

  setTheme(storedTheme || preferredTheme);
  themeButton?.addEventListener("click", () => {
    const nextTheme = root.dataset.theme === "dark" ? "light" : "dark";
    localStorage.setItem("autumn-theme", nextTheme);
    setTheme(nextTheme);
  });

  const articles = [
    ["GETTING STARTED", "welcome", "Welcome to Autumn Reader", "Meet the app and choose where to begin.", [
      ["What is Autumn Reader?", "Autumn Reader is a personal reader for organizing book files and reading them in a customizable interface. Your library brings books, favorites, and notes together, while the reader gives you controls tailored to the act of reading."],
      ["Before you begin", "You need a compatible book file, such as EPUB or PDF. Some options, including fonts and text layout, depend on the file format. Account and cloud features require a connection when data is being synchronized."],
      ["Your first visit", "Install the app, sign in with Google or use your email account, import a file, open it from the Library, adjust the page, and try adding a note."],
      ["Where to find help", "Use the navigation to open an individual guide. If a tool does not appear on your device, check the installed version and whether it requires a particular plan."]
    ]],
    ["GETTING STARTED", "installation", "Installation and platforms", "Learn how to access Autumn Reader on supported devices.", [
      ["Windows", "Use the Microsoft Store link on the Autumn Reader website to find the Windows release. Check the store listing and availability before installing."],
      ["Android", "The mobile version is part of the project. Check its current public availability on Google Play before looking for a direct installation link."],
      ["Updates", "Keep a recent version installed to receive fixes and new features. Changes in the source repository do not appear in an installed app until a new build is published."]
    ]],
    ["LIBRARY", "library", "Organize your library", "Import books and keep your collection in order.", [
      ["Import files", "Open Library and use the import option. Select one or more PDF or EPUB files, wait for them to be processed, and confirm that they appear in your collection."],
      ["Folders and organization", "Folders let you group titles in a way that makes sense to you. On desktop, you can also move books with drag and drop."],
      ["Edit a book", "Open a book's options and choose Edit to update available details such as its title, author, or cover. Metadata changes do not necessarily alter the contents of the original file."],
      ["Avoid duplicates", "When importing or syncing, the app tries to prevent duplicate copies. If two files are different editions of the same work, review their metadata before deciding which one to keep."]
    ], [{ src: "../assets/screenshots/library-dark.png", alt: "Autumn Reader library in dark mode with search, sorting, folders, and a book card", caption: "Library keeps organization tools close to the books without intruding on the reader." }]],
    ["LIBRARY", "formats", "PDF and EPUB formats", "Understand the important differences between the supported reading formats.", [
      ["EPUB", "EPUB is a flexible format: its text usually reflows to fit the screen and supports controls for font, spacing, and margins. Exact behavior depends on the book's contents."],
      ["PDF original pages", "Original mode preserves the authored page and is best for illustrated, academic, and fixed-layout documents. It provides zoom rather than reflow typography controls."],
      ["PDF adaptable text", "When a PDF has a usable text layer, adaptable mode composes that text as a focused reading page. You can change type, spacing, margins, columns, themes, and text size without enlarging the sheet itself."],
      ["Protected files", "An encrypted PDF or a file without extractable text can limit search, selection, and audio generation. DRM protection may prevent some files from opening."]
    ], [{ src: "../assets/screenshots/pdf-adaptable.png", alt: "An adaptable PDF arranged as a spacious two-column reading page", caption: "Adaptable PDF mode uses an editorial measure while retaining page-aware progress." }]],
    ["READING", "reader", "Navigate the reader", "Move through a book and return to your place.", [
      ["Open and continue", "Choose a title from Library or your recent books. Autumn Reader restores the saved page or section, including the position within adaptable PDF text."],
      ["Turn pages", "Use the page controls or the gestures available on your device. On mobile, swipe horizontally when the current reading mode supports it."],
      ["Contents and sections", "For books with a table of contents, use it to move between chapters. Availability depends on the structure of the file."],
      ["Search within a book", "Open the reader search, enter a word or phrase, and select a result to go to the matching passage. Temporary back and forward actions let you return to where you were reading."],
      ["Desktop window", "On Windows, the app title bar, sidebar, and bottom reading controls form one visual frame. Contents, Notes, and TTS remain reachable without covering the page."]
    ]],
    ["READING", "appearance", "Appearance and typography", "Shape the page around the way you read.", [
      ["App and book themes", "Choose a general theme in Settings and, when available, a specific appearance for the open book. The book theme takes priority inside its reader."],
      ["Font and size", "Adjust the text size and choose a typeface. Reflowable EPUB books provide more control than fixed-layout PDF files."],
      ["Spacing and composition", "Explore line height, word and letter spacing, indentation, margins, and columns. Make moderate changes and review the result on a page with a longer passage."],
      ["Show or hide notes", "Use Show notes in the book's Appearance panel to hide annotation marks for a quieter page. This changes only their visibility and never deletes the notes."],
      ["Light and dark modes", "Light mode provides a paper-like reading surface, while dark mode reduces the brightness of the background. Choose the one that suits your setting."]
    ]],
    ["TOOLS", "notes", "Notes and highlights", "Keep your ideas beside the text that inspired them.", [
      ["Create an annotation", "Select a passage and use the available note or highlight tool. Write your comment and save it."],
      ["Annotation appearance", "In Appearance, choose how annotations are shown, such as a highlight or underline, when that option is available in your version."],
      ["Return to a passage", "Open the book's notes list and select an entry to visit its associated passage. The return panel offers only two clear choices: go back to the page you left or continue reading from the note."],
      ["Hide markers", "Open Appearance inside the book and turn off Show notes when you want an uninterrupted page. Turn it on again to restore every saved marker."],
      ["Limitations", "Text selection may be unavailable in scanned PDF files without a text layer. Annotation support depends on the text that the reader can recognize."]
    ]],
    ["TOOLS", "translation", "Translation and dictionary", "Look up words without leaving your book.", [
      ["Translate a selection", "Select a word or passage and open the translation tool. Choose the target language when prompted."],
      ["Look up meanings", "Use the reader's dictionary, when available, to see a definition of the selected word."],
      ["Connection and limits", "Translation services may require an internet connection and may be subject to usage or plan limits. Results can vary by provider."]
    ]],
    ["AUDIO", "voice", "Read aloud inside a book", "Follow the narration from the exact part of the page you can see.", [
      ["Start from the visible page", "In EPUB and adaptable PDF, Read aloud begins with the visible text rather than returning to the start of the chapter. Long text is divided into coherent paragraph-sized fragments."],
      ["Keep your place", "The current word or passage is highlighted as it is spoken. Pausing keeps that marker on the page, and resuming continues from the same reading position whenever the engine supports it."],
      ["Reader controls", "Use previous, play or pause, stop, and next from the reader. You can choose among already installed voices and adjust speed. Pitch is available only when the active engine can apply it."],
      ["Preferences per book", "Speed, pitch, and an optional voice override are remembered separately for each book. Changing the voice inside a book does not replace the global default."],
      ["Continuous local playback", "Piper and Kokoro prepare the next fragment in the background to reduce gaps. Stopping, changing books, or closing the reader cancels pending work so delayed audio cannot begin later."]
    ], [{ src: "../assets/screenshots/tts-reading-highlight.png", alt: "Read aloud controls beside an EPUB with the current narrated word highlighted", caption: "The visible narration marker remains on the page while playback is paused." }]],
    ["AUDIO", "voice-library", "Installed voices and local models", "Manage system, Piper, and Kokoro voices without an online catalogue.", [
      ["Only installed voices", "Settings → Text to speech lists the offline system voices detected on the device and imported voices that passed validation. It does not show a store, remote catalogue, or uninstalled voice previews."],
      ["Import a prepared package", "Import voice accepts compatible Piper or Kokoro .tar.bz2 packages prepared for sherpa-onnx. Autumn Reader copies the model into private app storage, checks its structure, and verifies real synthesis before registering it."],
      ["Import a Kokoro voice file", "A compatible Kokoro 1.0 .bin voice can be added independently. If its matching base model is missing, the app keeps the selected voice pending and asks you to import the base package manually."],
      ["One shared Kokoro base", "Compatible Kokoro voices share one base model. Autumn Reader builds a derived voice index without changing the original model, and removing one voice does not remove the base or affect the others."],
      ["Defaults, samples, and removal", "Preview any installed voice, choose the default for each engine, and review its storage use. Native system voices are managed by Windows or Android; only files imported into Autumn Reader can be removed from the app."],
      ["Compatibility and licenses", "Piper and Kokoro require the native sherpa-onnx runtime and a compatible device build. Voice and model licenses can differ, so review the license of every file you import before commercial use."]
    ], [
      { src: "../assets/screenshots/offline-voice-library.png", alt: "Text-to-speech settings listing installed voices and an import voice action", caption: "The voice library lists only voices that are installed and ready for offline use." },
      { src: "../assets/screenshots/voice-import.png", alt: "Import voice dialog for a local Piper, Kokoro, or individual Kokoro voice file", caption: "Import begins with the file; technical fields appear only when they cannot be detected safely." }
    ]],
    ["CLOUD", "cloud", "Cloud synchronization", "Understand what stays on a device and what is saved to your account.", [
      ["Local books", "Local files remain available on the device where you imported them. They do not automatically appear on another device."],
      ["Cloud books", "Cloud storage keeps files connected to your account so you can retrieve them on authorized devices. Uploads and downloads require a connection."],
      ["Sync local books", "Use the account or plan options to find local book synchronization when it is available. Review which books will be uploaded before continuing."],
      ["Remove from the cloud", "Removing a cloud book frees remote storage, but does not necessarily delete an existing local copy. Check where a file is stored before removing it."],
      ["Offline reading", "Books already downloaded to a device can be read offline. A book stored only in the cloud must be downloaded before you can open it without internet access."]
    ]],
    ["ACCOUNT", "account", "Account and devices", "Manage access to your library.", [
      ["Sign in", "Continue with Google or use your email account. On packaged desktop clients, Google opens in the system browser and returns to Autumn Reader through its registered callback."],
      ["Authorized devices", "Autumn Reader registers installations to apply plan limits. Free currently supports up to two active devices; paid plans do not have this device limit."],
      ["Change your password", "Use the security options in account settings to update your password or begin account recovery."],
      ["Change accounts", "Local books remain separated by account on supported clients. Confirm that you are using the right profile before syncing."],
      ["If the browser does not return", "Update to a build that registers the autumnreader callback protocol. Finish the Google flow in the browser and allow the operating system to open Autumn Reader when prompted."]
    ]],
    ["ACCOUNT", "plans", "Plans and limits", "Compare the current capabilities of each tier.", [
      ["Free", "The Free plan includes 1 GiB of cloud storage, two active devices, local reading, and local text to speech. The reader does not show premium audio controls when they are not part of the active plan."],
      ["Autumn+", "Autumn+ currently includes 5 GiB of cloud storage, unlimited devices, and 60 minutes of premium voice generation each month."],
      ["Autumn Pro", "Autumn Pro currently includes 20 GiB of cloud storage, unlimited devices, and 180 minutes of premium voice generation each month."],
      ["Billing", "Subscriptions are managed through the billing service connected to the app. Confirm current prices, billing periods, and availability on the plan screen before purchasing."],
      ["Downgrading", "A lower quota does not automatically delete existing files. If your account exceeds the new limit, new uploads may be paused until you free enough space."]
    ]],
    ["HELP", "troubleshooting", "Troubleshooting", "Try these quick checks for common problems.", [
      ["A cover is missing", "Check that the book finished downloading and that its metadata includes a cover. On another device, confirm that synchronization is complete."],
      ["A file will not open", "Confirm that it is a valid PDF or EPUB file. Open it with another reader to rule out file damage or access restrictions."],
      ["Synchronization is not working", "Check the connection, active account, authorized devices, and available storage quota."],
      ["An imported voice fails", "Open Settings → Text to speech and confirm the engine is supported and the voice is still installed. Re-import a damaged package; for a Kokoro .bin file, also confirm that its compatible base model is present."],
      ["Read aloud starts too early", "Update Autumn Reader and open TTS only after the current EPUB page is visible. The current version starts from visible text; scanned PDFs without a usable text layer cannot provide that position."],
      ["An option is missing", "Some features vary by platform, format, plan, or app version. Check the relevant guide and make sure the app is up to date."]
    ]]
  ];

  const nav = document.getElementById("nav");
  if (!nav) return;

  let current = location.hash.slice(1) || "welcome";
  const search = document.getElementById("search");

  function drawNav(query = "") {
    let lastCategory = "";
    const normalizedQuery = query.trim().toLowerCase();
    nav.replaceChildren();
    const matches = articles.filter(article => `${article[0]} ${article[2]} ${article[3]}`.toLowerCase().includes(normalizedQuery));
    if (!matches.length) {
      const empty = document.createElement("p");
      empty.className = "empty-search";
      empty.textContent = "No guides match your search.";
      nav.append(empty);
      return;
    }
    matches.forEach(article => {
      if (article[0] !== lastCategory) {
        const category = document.createElement("p");
        category.className = "nav-category";
        category.textContent = article[0];
        nav.append(category);
        lastCategory = article[0];
      }
      const link = document.createElement("a");
      link.className = `nav-link${current === article[1] ? " active" : ""}`;
      link.href = `#${article[1]}`;
      link.textContent = article[2];
      if (current === article[1]) link.setAttribute("aria-current", "page");
      nav.append(link);
    });
  }

  function render() {
    current = location.hash.slice(1) || "welcome";
    const requestedIndex = articles.findIndex(article => article[1] === current);
    const index = requestedIndex >= 0 ? requestedIndex : 0;
    const article = articles[index];
    current = article[1];
    const content = document.getElementById("doc-content");
    const toc = document.getElementById("toc");
    content.replaceChildren();
    toc.replaceChildren();

    const category = document.createElement("p");
    category.className = "eyebrow";
    category.textContent = `${article[0]} / GUIDE`;
    const title = document.createElement("h1");
    title.textContent = article[2];
    const intro = document.createElement("p");
    intro.className = "intro-text";
    intro.textContent = article[3];
    content.append(category, title, intro);

    (article[5] ?? []).forEach(media => {
      const figure = document.createElement("figure");
      figure.className = "doc-figure";
      const image = document.createElement("img");
      image.src = media.src;
      image.alt = media.alt;
      image.loading = "lazy";
      image.width = 1200;
      image.height = 800;
      const caption = document.createElement("figcaption");
      caption.textContent = media.caption;
      figure.append(image, caption);
      content.append(figure);
    });

    article[4].forEach((section, sectionIndex) => {
      const heading = document.createElement("h2");
      heading.id = `section-${sectionIndex}`;
      heading.textContent = section[0];
      const paragraph = document.createElement("p");
      paragraph.textContent = section[1];
      content.append(heading, paragraph);
      const link = document.createElement("a");
      link.href = `#${heading.id}`;
      link.textContent = section[0];
      link.addEventListener("click", event => {
        event.preventDefault();
        heading.scrollIntoView({ behavior: "smooth" });
      });
      toc.append(link);
    });

    const tip = document.createElement("div");
    tip.className = "tip";
    const tipLabel = document.createElement("strong");
    tipLabel.textContent = "Note: ";
    tip.append(tipLabel, "Options may vary by app version, book format, operating system, active plan, and the capabilities of an installed speech engine. Availability shown inside the app takes precedence over this guide.");
    content.append(tip);

    const previous = document.getElementById("prev");
    const next = document.getElementById("next");
    previous.disabled = index === 0;
    next.disabled = index === articles.length - 1;
    previous.onclick = () => { location.hash = articles[index - 1][1]; };
    next.onclick = () => { location.hash = articles[index + 1][1]; };
    drawNav(search.value);
    window.scrollTo({ top: 0, behavior: "instant" });
  }

  search.addEventListener("input", event => drawNav(event.target.value));
  window.addEventListener("hashchange", render);
  window.addEventListener("keydown", event => {
    if (event.key === "/" && !["INPUT", "TEXTAREA"].includes(document.activeElement.tagName)) {
      event.preventDefault();
      search.focus();
    }
  });
  render();
}());
