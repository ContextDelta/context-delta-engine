(() => {
  const body = document.body;

  const progress = document.createElement("div");
  progress.className = "scroll-progress";
  progress.setAttribute("aria-hidden", "true");
  progress.innerHTML = "<span></span>";
  body.prepend(progress);

  const topButton = document.createElement("button");
  topButton.className = "scroll-top";
  topButton.type = "button";
  topButton.setAttribute("aria-label", "Scroll to top");
  topButton.textContent = "↑";
  body.append(topButton);

  const updateScrollState = () => {
    const scrollTop = window.scrollY || document.documentElement.scrollTop;
    const maxScroll = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    progress.firstElementChild.style.width = `${Math.min(100, (scrollTop / maxScroll) * 100)}%`;
    topButton.classList.toggle("is-visible", scrollTop > 80);
  };

  const updateActiveTab = () => {
    const tabs = Array.from(document.querySelectorAll(".doc-nav a"));
    if (!tabs.length) return;

    const ids = tabs
      .map((tab) => tab.getAttribute("href"))
      .filter((href) => href?.startsWith("#"))
      .map((href) => href.slice(1));

    let activeId = ids[0];
    for (const id of ids) {
      const section = document.getElementById(id);
      if (section && section.getBoundingClientRect().top <= 150) activeId = id;
    }

    for (const tab of tabs) {
      const isActive = tab.getAttribute("href") === `#${activeId}`;
      tab.classList.toggle("active", isActive);
      tab.setAttribute("aria-current", isActive ? "true" : "false");
    }
  };

  topButton.addEventListener("click", () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  window.addEventListener("scroll", () => {
    updateScrollState();
    updateActiveTab();
  }, { passive: true });

  window.addEventListener("resize", updateScrollState);
  window.addEventListener("hashchange", updateActiveTab);

  updateScrollState();
  updateActiveTab();
})();
