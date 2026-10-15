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
      ["Your first visit", "Install the app, sign in or create an account, import a file, open it from the Library, adjust the theme and typography, and try adding a note or bookmark."],
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
    ]],
    ["LIBRARY", "formats", "PDF and EPUB formats", "Understand the important differences between the supported reading formats.", [
      ["EPUB", "EPUB is a flexible format: its text usually reflows to fit the screen and supports controls for font, spacing, and margins. Exact behavior depends on the book's contents."],
      ["PDF", "PDF preserves a fixed layout. It can be ideal for illustrated or academic documents, but typographic controls do not apply in the same way they do to EPUB."],
      ["Protected files", "An encrypted PDF or a file without extractable text can limit search, selection, and audio generation. DRM protection may prevent some files from opening."]
    ]],
    ["READING", "reader", "Navigate the reader", "Move through a book and return to your place.", [
      ["Open and continue", "Choose a title from Library or your recent books. Autumn Reader saves your reading position so you can continue more easily."],
      ["Turn pages", "Use the page controls or the gestures available on your device. On mobile, swipe horizontally when the current reading mode supports it."],
      ["Contents and sections", "For books with a table of contents, use it to move between chapters. Availability depends on the structure of the file."],
      ["Search within a book", "Open the reader search, enter a word or phrase, and select a result to go to the matching passage."]
    ]],
    ["READING", "appearance", "Appearance and typography", "Shape the page around the way you read.", [
      ["App and book themes", "Choose a general theme in Settings and, when available, a specific appearance for the open book. The book theme takes priority inside its reader."],
      ["Font and size", "Adjust the text size and choose a typeface. Reflowable EPUB books provide more control than fixed-layout PDF files."],
      ["Spacing and composition", "Explore line height, word and letter spacing, indentation, margins, and columns. Make moderate changes and review the result on a page with a longer passage."],
      ["Light and dark modes", "Light mode provides a paper-like reading surface, while dark mode reduces the brightness of the background. Choose the one that suits your setting."]
    ]],
    ["TOOLS", "notes", "Notes and highlights", "Keep your ideas beside the text that inspired them.", [
      ["Create an annotation", "Select a passage and use the available note or highlight tool. Write your comment and save it."],
      ["Annotation appearance", "In Appearance, choose how annotations are shown, such as a highlight or underline, when that option is available in your version."],
      ["Return to a passage", "Open the book's notes list and select an entry to return to its associated passage."],
      ["Limitations", "Text selection may be unavailable in scanned PDF files without a text layer. Annotation support depends on the text that the reader can recognize."]
    ]],
    ["TOOLS", "translation", "Translation and dictionary", "Look up words without leaving your book.", [
      ["Translate a selection", "Select a word or passage and open the translation tool. Choose the target language when prompted."],
      ["Look up meanings", "Use the reader's dictionary, when available, to see a definition of the selected word."],
      ["Connection and limits", "Translation services may require an internet connection and may be subject to usage or plan limits. Results can vary by provider."]
    ]],
    ["AUDIO", "voice", "Read aloud", "Listen with voices on your device or premium audio.", [
      ["Device voices", "On-device text to speech is the default option available on Free. Quality and variety depend on the voices installed on your system, and it may work without an internet connection."],
      ["Premium voice", "Autumn Reader includes a premium neural voice option. Autumn+ currently includes 60 minutes of generation per monthly cycle, while Autumn Pro includes 180 minutes."],
      ["How generation works", "Premium voice processes authorized passages from a book and may reuse audio generated previously. It requires an internet connection and service availability."],
      ["PDF text errors", "For some PDF files, the app may be unable to find verifiable text or extract it correctly. If this happens, try an EPUB or a PDF with selectable text."]
    ]],
    ["CLOUD", "cloud", "Cloud synchronization", "Understand what stays on a device and what is saved to your account.", [
      ["Local books", "Local files remain available on the device where you imported them. They do not automatically appear on another device."],
      ["Cloud books", "Cloud storage keeps files connected to your account so you can retrieve them on authorized devices. Uploads and downloads require a connection."],
      ["Sync local books", "Use the account or plan options to find local book synchronization when it is available. Review which books will be uploaded before continuing."],
      ["Remove from the cloud", "Removing a cloud book frees remote storage, but does not necessarily delete an existing local copy. Check where a file is stored before removing it."],
      ["Offline reading", "Books already downloaded to a device can be read offline. A book stored only in the cloud must be downloaded before you can open it without internet access."]
    ]],
    ["ACCOUNT", "account", "Account and devices", "Manage access to your library.", [
      ["Sign in", "Use your account to access services connected to your profile, including books stored in the cloud."],
      ["Authorized devices", "Autumn Reader registers installations to apply plan limits. Free currently supports up to two active devices; paid plans do not have this device limit."],
      ["Change your password", "Use the security options in account settings to update your password or begin account recovery."],
      ["Change accounts", "Local books remain separated by account on supported clients. Confirm that you are using the right profile before syncing."]
    ]],
    ["ACCOUNT", "plans", "Plans and limits", "Compare the current capabilities of each tier.", [
      ["Free", "The Free plan includes 1 GiB of cloud storage, two active devices, local reading, and on-device text to speech."],
      ["Autumn+", "Autumn+ currently includes 5 GiB of cloud storage, unlimited devices, and 60 minutes of premium voice generation each month."],
      ["Autumn Pro", "Autumn Pro currently includes 20 GiB of cloud storage, unlimited devices, and 180 minutes of premium voice generation each month."],
      ["Billing", "Subscriptions are managed through the billing service connected to the app. Confirm current prices, billing periods, and availability on the plan screen before purchasing."],
      ["Downgrading", "A lower quota does not automatically delete existing files. If your account exceeds the new limit, new uploads may be paused until you free enough space."]
    ]],
    ["HELP", "troubleshooting", "Troubleshooting", "Try these quick checks for common problems.", [
      ["A cover is missing", "Check that the book finished downloading and that its metadata includes a cover. On another device, confirm that synchronization is complete."],
      ["A file will not open", "Confirm that it is a valid PDF or EPUB file. Open it with another reader to rule out file damage or access restrictions."],
      ["Synchronization is not working", "Check the connection, active account, authorized devices, and available storage quota."],
      ["Premium voice fails", "Try an EPUB that contains text. If the problem occurs only with one PDF, text extraction or validation may be the cause."],
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
    tip.append(tipLabel, "Options may vary by version, book format, and active plan. Availability shown inside the app takes precedence over this guide.");
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
