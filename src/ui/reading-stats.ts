import { language, type Language } from "../i18n";
import { auth } from "../services/auth";
import { plans } from "../services/plans";
import { readingActivity } from "../services/reading/activity";

const dayKey = (date: Date): string => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const dateOffset = (days: number): Date => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + days); return d; };
const translations = {
  'statsTitle': {es: 'Estadísticas de lectura', en: 'Reading statistics', it: 'Statistiche di lettura', fr: 'Statistiques de lecture'},
  'viewStats': {es: 'Ver estadísticas', en: 'View statistics', it: 'Visualizza statistiche', fr: 'Voir les statistiques'},
  'back': {es: '← Volver al perfil', en: '← Back to profile', it: '← Torna al profilo', fr: '← Retour au profil'},
  'journal': {es: 'TU DIARIO DE LECTURA', en: 'YOUR READING JOURNAL', it: 'IL TUO DIARIO DI LETTURA', fr: 'VOTRE JOURNAL DE LECTURE'},
  'intro': {es: 'Cada página deja una historia. Descubrí tus hábitos de lectura.', en: 'Every page tells a story. Discover your reading habits.', it: 'Ogni pagina racconta una storia. Scopri le tue abitudini di lettura.', fr: 'Chaque page raconte une histoire. Découvrez vos habitudes de lecture.'},
  'signIn': {es: 'Iniciá sesión para consultar tus estadísticas.', en: 'Sign in to view your statistics.', it: 'Accedi per consultare le tue statistiche.', fr: 'Connectez-vous pour consulter vos statistiques.'},
  'loading': {es: 'Cargando estadísticas…', en: 'Loading statistics…', it: 'Caricamento delle statistiche…', fr: 'Chargement des statistiques…'},
  'activeTime': {es: 'Tiempo activo', en: 'Active reading time', it: 'Tempo di lettura attivo', fr: 'Temps de lecture actif'},
  'sessions': {es: 'Sesiones', en: 'Sessions', it: 'Sessioni', fr: 'Sessions'},
  'openedBooks': {es: 'Libros abiertos', en: 'Books opened', it: 'Libri aperti', fr: 'Livres ouverts'},
  'activeDays': {es: 'Días activos · 30 días', en: 'Active days · 30 days', it: 'Giorni attivi · 30 giorni', fr: 'Jours actifs · 30 jours'},
  'streak': {es: 'Racha actual', en: 'Current streak', it: 'Serie attuale', fr: 'Série actuelle'},
  'calendar': {es: 'Calendario de lectura', en: 'Reading calendar', it: 'Calendario di lettura', fr: 'Calendrier de lecture'},
  'last12': {es: 'Últimos 12 meses', en: 'Last 12 months', it: 'Ultimi 12 mesi', fr: '12 derniers mois'},
  'less': {es: 'Menos', en: 'Less', it: 'Meno', fr: 'Moins'},
  'more': {es: 'Más', en: 'More', it: 'Più', fr: 'Plus'},
  'note': {es: 'La actividad se agrupa por fecha de guardado de cada sesión. Los datos anteriores a la activación del seguimiento no están disponibles.', en: 'Activity is grouped by each session’s saved date. Data from before tracking was enabled is unavailable.', it: 'Le attività sono raggruppate per data di salvataggio di ogni sessione. I dati precedenti all’attivazione del monitoraggio non sono disponibili.', fr: 'L’activité est regroupée par date d’enregistrement de chaque session. Les données antérieures à l’activation du suivi ne sont pas disponibles.'},
  'daily': {es: 'Tiempo de lectura diario', en: 'Daily reading time', it: 'Tempo di lettura giornaliero', fr: 'Temps de lecture quotidien'},
  'last14': {es: 'Últimos 14 días', en: 'Last 14 days', it: 'Ultimi 14 giorni', fr: '14 derniers jours'},
  'unlock': {es: 'Desbloqueá el gráfico de actividad diaria con Autumn+ o Autumn Pro.', en: 'Unlock the daily activity chart with Autumn+ or Autumn Pro.', it: 'Sblocca il grafico dell’attività giornaliera con Autumn+ o Autumn Pro.', fr: 'Débloquez le graphique d’activité quotidienne avec Autumn+ ou Autumn Pro.'},
  'byBook': {es: 'Tiempo de lectura por libro', en: 'Reading time by book', it: 'Tempo di lettura per libro', fr: 'Temps de lecture par livre'},
  'registeredBooks': {es: 'libros registrados', en: 'books recorded', it: 'libri registrati', fr: 'livres enregistrés'},
  'noSessions': {es: 'Todavía no hay sesiones registradas.', en: 'No reading sessions recorded yet.', it: 'Non ci sono ancora sessioni registrate.', fr: 'Aucune session enregistrée pour le moment.'},
  'unavailableLibrary': {es: 'Libro no disponible en la biblioteca', en: 'Book not available in the library', it: 'Libro non disponibile nella biblioteca', fr: 'Livre indisponible dans la bibliothèque'},
  'unavailable': {es: 'Libro no disponible', en: 'Book unavailable', it: 'Libro non disponibile', fr: 'Livre indisponible'},
  'distribution': {es: 'Distribución de lectura', en: 'Reading distribution', it: 'Distribuzione della lettura', fr: 'Répartition de la lecture'},
  'perBook': {es: 'Por libro', en: 'By book', it: 'Per libro', fr: 'Par livre'},
  'totalTime': {es: 'Tiempo total', en: 'Total time', it: 'Tempo totale', fr: 'Temps total'},
  'startReading': {es: 'Empezá a leer para ver cómo se distribuye tu tiempo.', en: 'Start reading to see how your time is distributed.', it: 'Inizia a leggere per vedere come distribuisci il tuo tempo.', fr: 'Commencez à lire pour voir comment se répartit votre temps.'},
  'readingHours': {es: 'Tus horarios de lectura', en: 'Your reading hours', it: 'I tuoi orari di lettura', fr: 'Vos heures de lecture'},
  'sessionHours': {es: 'Sesiones iniciadas según la hora del día', en: 'Sessions started by time of day', it: 'Sessioni iniziate per ora del giorno', fr: 'Sessions commencées selon l’heure de la journée'},
  'habits': {es: 'Más sobre tus hábitos', en: 'More about your habits', it: 'Altre informazioni sulle tue abitudini', fr: 'En savoir plus sur vos habitudes'},
  'subscription': {es: 'Funciones adicionales según tu suscripción', en: 'Additional features based on your subscription', it: 'Funzionalità aggiuntive in base al tuo abbonamento', fr: 'Fonctionnalités supplémentaires selon votre abonnement'},
  'finished': {es: 'Libros terminados', en: 'Books finished', it: 'Libri terminati', fr: 'Livres terminés'},
  'finishedDetail': {es: 'Tu historial de lecturas completadas', en: 'Your completed reading history', it: 'La cronologia delle letture completate', fr: 'Votre historique des lectures terminées'},
  'trends': {es: 'Tendencias', en: 'Trends', it: 'Tendenze', fr: 'Tendances'},
  'trendsDetail': {es: 'Analizá la evolución de tu hábito', en: 'Explore how your reading habit evolves', it: 'Analizza l’evoluzione delle tue abitudini', fr: 'Analysez l’évolution de vos habitudes'},
  'comparisons': {es: 'Comparativas', en: 'Comparisons', it: 'Confronti', fr: 'Comparaisons'},
  'comparisonsDetail': {es: 'Compará períodos y objetivos', en: 'Compare periods and goals', it: 'Confronta periodi e obiettivi', fr: 'Comparez les périodes et les objectifs'},
  'loadError': {es: 'No se pudieron cargar las estadísticas locales.', en: 'Could not load local reading statistics.', it: 'Impossibile caricare le statistiche di lettura locali.', fr: 'Impossible de charger les statistiques de lecture locales.'}
} as const;
type StatsKey = keyof typeof translations;
const tr = (key: StatsKey): string => translations[key][language] ?? translations[key].en;
const locale = (): string => ({ es: "es-AR", en: "en-US", it: "it-IT", fr: "fr-FR" } as Record<Language, string>)[language];
const timeLabel = (ms: number): string => {
  const seconds = Math.floor(Math.max(0, ms) / 1000);
  if (seconds < 60) return `${seconds} s`;
  const mins = Math.floor(seconds / 60);
  return mins < 60 ? `${mins} min` : `${Math.floor(mins / 60)} h ${mins % 60} min`;
};
const longDate = (date: Date): string => date.toLocaleDateString(locale(), { day: "numeric", month: "long", year: "numeric" });
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

/** Local-only reading statistics, isolated by account. */
export function mountReadingStats(parent: HTMLElement, page: HTMLElement, onOpen: () => void, onBack: () => void, getBooks: () => { id: string; name: string; author: string; cover?: () => HTMLElement }[]): void {
  const toggle = el("button", "secondary-button reading-stats-toggle", tr("viewStats"));
  toggle.type = "button";
  toggle.hidden = true;
  const content = el("div", "reading-stats-content");
  const pageHeader = el("div", "reading-stats-page-heading");
  const back = el("button", "secondary-button", tr("back"));
  back.type = "button";
  back.addEventListener("click", onBack);
  const intro = el("div", "reading-stats-intro");
  intro.append(el("span", "reading-stats-eyebrow", tr("journal")), el("h1", "", tr("statsTitle")), el("p", "", tr("intro")));
  const ornament = el("div", "reading-stats-ornament");
  ornament.setAttribute("aria-hidden", "true");
  ornament.textContent = "❧";
  pageHeader.append(back, intro, ornament);
  page.append(pageHeader, content);
  parent.querySelector<HTMLElement>(".profile-actions")?.append(toggle);
  let revision = 0;

  const hasAccess = async (owner: string): Promise<boolean> => {
    if (auth.state.status !== "authenticated" || auth.state.ownerId !== owner || !navigator.onLine) return false;
    try {
      const entitlement = await plans.current();
      return auth.state.ownerId === owner && Boolean(entitlement.advanced_stats);
    } catch {
      return false;
    }
  };

  const refreshAccess = async (): Promise<void> => {
    const token = ++revision;
    const owner = auth.state.ownerId;
    toggle.hidden = true;
    if (!owner || !await hasAccess(owner)) return;
    if (token === revision && auth.state.ownerId === owner) toggle.hidden = false;
  };

  const render = async (): Promise<void> => {
    const token = ++revision;
    const owner = auth.state.ownerId;
    if (!owner) { content.textContent = tr("signIn"); return; }
    content.textContent = tr("loading");
    try {
      if (!await hasAccess(owner)) {
        if (token === revision) {
          content.replaceChildren();
          toggle.hidden = true;
          onBack();
        }
        return;
      }
      const sessions = await readingActivity.sessions(owner);
      if (token !== revision || auth.state.ownerId !== owner || !page.isConnected) return;
      const daily = new Map<string, number>();
      const books = new Map<string, number>();
      let total = 0;
      for (const s of sessions) {
        if (!Number.isFinite(s.endedAt) || !Number.isFinite(s.activeMs)) continue;
        const ms = Math.max(0, s.activeMs);
        daily.set(dayKey(new Date(s.endedAt)), (daily.get(dayKey(new Date(s.endedAt))) ?? 0) + ms);
        books.set(s.bookId, (books.get(s.bookId) ?? 0) + ms);
        total += ms;
      }
      const days30 = Array.from({ length: 30 }, (_, i) => dateOffset(i - 29));
      const activeDays = days30.filter(d => (daily.get(dayKey(d)) ?? 0) > 0).length;
      let streak = 0;
      for (let i = 0; i < 366; i++) {
        const ms = daily.get(dayKey(dateOffset(-i))) ?? 0;
        if (i === 0 && !ms) continue;
        if (!ms) break;
        streak++;
      }
      const summary = el("div", "reading-stats-summary");
      const cards: [string, string, string][] = [
        [timeLabel(total), tr("activeTime"), "◷"],
        [String(sessions.length), tr("sessions"), "▥"],
        [String(books.size), tr("openedBooks"), "▤"],
        [String(activeDays), tr("activeDays"), "▦"],
        [String(streak), tr("streak"), "♨"],
      ];
      for (const [value, label, symbol] of cards) {
        const card = el("div", "reading-stats-metric");
        const icon = el("span", "reading-stats-metric-icon", symbol);
        icon.setAttribute("aria-hidden", "true");
        const words = el("div", "reading-stats-metric-words");
        words.append(el("strong", "", value), el("span", "", label));
        card.append(icon, words);
        summary.append(card);
      }
      const calendarSection = el("section", "reading-stats-panel");
      const calendarHeader = el("div", "reading-stats-panel-heading");
      calendarHeader.append(el("h3", "", tr("calendar")), el("span", "reading-stats-muted", tr("last12")));
      const calendarScroll = el("div", "reading-stats-calendar-scroll");
      const calendar = el("div", "reading-stats-heatmap");
      const today = dateOffset(0);
      const first = dateOffset(-364);
      // Begin on Monday so columns correspond to calendar weeks.
      const mondayOffset = (first.getDay() + 6) % 7;
      first.setDate(first.getDate() - mondayOffset);
      const last = new Date(today);
      const sundayOffset = 6 - ((last.getDay() + 6) % 7);
      last.setDate(last.getDate() + sundayOffset);
      const heatDays: Date[] = [];
      for (const d = new Date(first); d <= last; d.setDate(d.getDate() + 1)) heatDays.push(new Date(d));
      const peak = Math.max(1, ...heatDays.map(d => daily.get(dayKey(d)) ?? 0));
      const monthRow = el("div", "reading-stats-months");
      const weeks = Math.ceil(heatDays.length / 7);
      let lastMonth = -1;
      for (let w = 0; w < weeks; w++) {
        const d = heatDays[w * 7];
        const month = d.getMonth();
        const label = el("span", "", month !== lastMonth ? d.toLocaleDateString(locale(), { month: "short" }) : "");
        monthRow.append(label);
        lastMonth = month;
      }
      calendar.append(monthRow);
      const calendarBody = el("div", "reading-stats-heatmap-body");
      const weekdayLabels = el("div", "reading-stats-weekdays");
      for (const label of ({ es: ["L", "", "M", "", "V", "", "D"], en: ["M", "", "W", "", "F", "", "S"], it: ["L", "", "M", "", "V", "", "D"], fr: ["L", "", "M", "", "V", "", "D"] } as Record<Language, string[]>)[language]) weekdayLabels.append(el("span", "", label));
      calendarBody.append(weekdayLabels);
      const cells = el("div", "reading-stats-heatmap-cells");
      for (const date of heatDays) {
        const ms = daily.get(dayKey(date)) ?? 0;
        const cell = el("span", "reading-stats-day");
        const outOfRange = date.getTime() > today.getTime() || date.getTime() < dateOffset(-364).getTime();
        cell.dataset.level = outOfRange ? "outside" : ms === 0 ? "0" : String(Math.max(1, Math.ceil(ms / peak * 4)));
        const description = `${longDate(date)}: ${timeLabel(ms)}`;
        cell.title = description;
        cell.setAttribute("aria-label", description);
        cells.append(cell);
      }
      calendarBody.append(cells);
      calendar.append(calendarBody);
      calendarScroll.append(calendar);
      const legend = el("div", "reading-stats-legend");
      legend.append(el("span", "", tr("less")));
      for (let level = 0; level <= 4; level++) { const swatch = el("span", "reading-stats-day"); swatch.dataset.level = String(level); legend.append(swatch); }
      legend.append(el("span", "", tr("more")));
      calendarSection.append(calendarHeader, calendarScroll, legend);
      const note = el("p", "reading-stats-note", tr("note"));
      const visualGrid = el("div", "reading-stats-visual-grid");
      visualGrid.append(calendarSection);
      content.replaceChildren(summary, visualGrid);
      const graphPanel = el("section", "reading-stats-panel");
      const graphHeader = el("div", "reading-stats-panel-heading");
      graphHeader.append(el("h3", "", tr("daily")), el("span", "reading-stats-muted", tr("last14")));
      const graph = el("div", "reading-stats-chart");
      const recent = Array.from({ length: 14 }, (_, i) => dateOffset(i - 13));
      const max = Math.max(60_000, ...recent.map(d => daily.get(dayKey(d)) ?? 0));
      for (const d of recent) {
        const ms = daily.get(dayKey(d)) ?? 0;
        const col = el("div", "reading-stats-chart-column");
        const track = el("div", "reading-stats-chart-track");
        const bar = el("div", "reading-stats-chart-bar");
        bar.style.height = `${ms ? Math.max(3, ms / max * 100) : 0}%`;
        bar.title = `${longDate(d)}: ${timeLabel(ms)}`;
        track.append(bar);
        col.append(track, el("span", "reading-stats-chart-label", d.toLocaleDateString(locale(), { day: "numeric" })));
        graph.append(col);
      }
      graphPanel.append(graphHeader, graph);
      visualGrid.append(graphPanel);
      const lowerGrid = el("div", "reading-stats-lower-grid");
      const bookPanel = el("section", "reading-stats-panel");
      const bookHeader = el("div", "reading-stats-panel-heading");
      bookHeader.append(el("h3", "", tr("byBook")), el("span", "reading-stats-muted", `${books.size} ${tr("registeredBooks")}`));
      bookPanel.append(bookHeader);
      const knownBooks = new Map(getBooks().map(book => [book.id, book]));
      const ranked = [...books.entries()].sort((a, b) => b[1] - a[1]);
      if (!ranked.length) bookPanel.append(el("p", "reading-stats-note", tr("noSessions")));
      else {
        const list = el("div", "reading-stats-book-list");
        const maxBook = Math.max(1, ranked[0][1]);
        for (const [bookId, ms] of ranked) {
          const book = knownBooks.get(bookId);
          const item = el("div", "reading-stats-book-row");
          const coverSlot = el("div", "reading-stats-book-cover");
          if (book?.cover) coverSlot.append(book.cover());
          else {
            const fallback = el("div", "reading-stats-book-cover-placeholder", "✦");
            fallback.setAttribute("aria-hidden", "true");
            coverSlot.append(fallback);
          }
          const details = el("div", "reading-stats-book-details");
          details.append(el("strong", "", book?.name || tr("unavailableLibrary")));
          if (book?.author) details.append(el("span", "reading-stats-muted", book.author));
          const share = total > 0 ? Math.round(ms / total * 100) : 0;
          const duration = el("span", "reading-stats-book-time", `${timeLabel(ms)} · ${share}%`);
          const track = el("div", "reading-stats-book-track");
          const fill = el("span", "reading-stats-book-fill");
          fill.style.width = `${ms > 0 ? Math.max(2, ms / maxBook * 100) : 0}%`;
          track.append(fill);
          const textColumn = el("div", "reading-stats-book-text");
          textColumn.append(details, track);
          item.append(coverSlot, textColumn, duration);
          list.append(item);
        }
        bookPanel.append(list);
      }
      lowerGrid.append(bookPanel);
      const distribution = el("section", "reading-stats-panel reading-stats-distribution");
      const distributionHeader = el("div", "reading-stats-panel-heading");
      distributionHeader.append(el("h3", "", tr("distribution")), el("span", "reading-stats-muted", tr("perBook")));
      distribution.append(distributionHeader);
      if (total > 0 && ranked.length) {
        const palette = ["#793a29", "#bc8159", "#d9ad7d", "#98755f", "#b99b86", "#d8c9b8"];
        let accumulated = 0;
        const parts = ranked.map(([, ms], index) => {
          const start = accumulated / total * 100;
          accumulated += ms;
          return `${palette[index % palette.length]} ${start}% ${accumulated / total * 100}%`;
        });
        const donut = el("div", "reading-stats-donut");
        donut.style.background = `conic-gradient(${parts.join(",")})`;
        const center = el("div", "reading-stats-donut-center");
        center.append(el("strong", "", timeLabel(total)), el("span", "", tr("totalTime")));
        donut.append(center);
        const legendList = el("div", "reading-stats-distribution-list");
        for (const [index, [bookId, ms]] of ranked.slice(0, 6).entries()) {
          const entry = el("div", "reading-stats-distribution-item");
          const swatch = el("span", "reading-stats-distribution-swatch");
          swatch.style.backgroundColor = palette[index % palette.length];
          const name = el("span", "reading-stats-distribution-name", knownBooks.get(bookId)?.name || tr("unavailable"));
          entry.append(swatch, name, el("strong", "", `${Math.round(ms / total * 100)}%`));
          legendList.append(entry);
        }
        distribution.append(el("div", "reading-stats-distribution-body"));
        distribution.lastElementChild?.append(donut, legendList);
      } else distribution.append(el("p", "reading-stats-muted", tr("startReading")));
      lowerGrid.append(distribution);
      content.append(lowerGrid);
      const extra = el("section", "reading-stats-extra");
      const hoursPanel = el("div", "reading-stats-panel");
      hoursPanel.append(el("h3", "", tr("readingHours")), el("p", "reading-stats-muted", tr("sessionHours")));
      const hourly = Array.from({ length: 24 }, () => 0);
      for (const session of sessions) if (Number.isFinite(session.startedAt)) hourly[new Date(session.startedAt).getHours()] += Math.max(0, session.activeMs);
      const hourPeak = Math.max(1, ...hourly);
      const hourChart = el("div", "reading-stats-hour-chart");
      hourly.forEach((ms, hour) => {
        const col = el("div", "reading-stats-hour-column");
        const bar = el("span", "reading-stats-hour-bar");
        bar.style.height = `${ms ? Math.max(4, ms / hourPeak * 100) : 0}%`;
        bar.title = `${String(hour).padStart(2,"0")}:00 — ${timeLabel(ms)}`;
        col.append(bar, el("small", "", hour % 4 === 0 ? String(hour).padStart(2,"0") : ""));
        hourChart.append(col);
      });
      hoursPanel.append(hourChart);
      const features = el("div", "reading-stats-panel reading-stats-features");
      features.append(el("h3", "", tr("habits")), el("p", "reading-stats-muted", tr("subscription")));
      const featureGrid = el("div", "reading-stats-feature-grid");
      for (const [label, detail, tier] of [
        [tr("finished"), tr("finishedDetail"), "Autumn+"],
        [tr("trends"), tr("trendsDetail"), "Autumn+"],
        [tr("comparisons"), tr("comparisonsDetail"), "Autumn Pro"],
      ]) {
        const feature = el("div", "reading-stats-feature");
        feature.append(el("span", "reading-stats-feature-lock", "◇"), el("strong", "", label), el("small", "", detail), el("em", "", tier));
        featureGrid.append(feature);
      }
      features.append(featureGrid);
      extra.append(hoursPanel, features);
      content.append(extra, note);
    } catch (error) {
      if (token === revision) content.textContent = tr("loadError");
      console.error("Reading statistics error", error);
    }
  };
  toggle.addEventListener("click", () => {
    const owner = auth.state.ownerId;
    if (!owner) return;
    toggle.disabled = true;
    void hasAccess(owner).then(allowed => {
      if (!allowed) { toggle.hidden = true; return; }
      onOpen();
      void render();
    }).finally(() => { toggle.disabled = false; });
  });
  auth.subscribe(() => {
    ++revision;
    content.replaceChildren();
    if (!page.hidden) onBack();
    void refreshAccess();
  });
  window.addEventListener("online", () => void refreshAccess());
  window.addEventListener("offline", () => { ++revision; toggle.hidden = true; if (!page.hidden) onBack(); });
  window.addEventListener("autumn-local-change", () => { if (!page.hidden) void render(); });
}
