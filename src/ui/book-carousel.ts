/** Native scrolling with controls for pointer and keyboard users. */
export function mountBookCarousel(track: HTMLElement, previous: HTMLButtonElement, next: HTMLButtonElement): { update(): void } {
  const controls = previous.parentElement;
  const update = (): void => {
    const overflow = track.scrollWidth > track.clientWidth + 2;
    if (controls) controls.hidden = !overflow;
    previous.disabled = !overflow || track.scrollLeft <= 2;
    next.disabled = !overflow || track.scrollLeft + track.clientWidth >= track.scrollWidth - 2;
  };
  const move = (direction: -1 | 1): void => {
    track.scrollBy({ left: direction * Math.max(150, Math.floor(track.clientWidth * .76)), behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
  };
  previous.addEventListener("click", () => move(-1));
  next.addEventListener("click", () => move(1));
  track.addEventListener("scroll", update, { passive: true });
  track.addEventListener("keydown", event => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    move(event.key === "ArrowLeft" ? -1 : 1);
  });
  track.addEventListener("wheel", event => {
    if (!event.shiftKey || !event.deltaY) return;
    event.preventDefault();
    track.scrollBy({ left: event.deltaY, behavior: "auto" });
  }, { passive: false });
  window.addEventListener("resize", update);
  return { update };
}
