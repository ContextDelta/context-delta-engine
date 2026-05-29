const topLink = document.querySelector(".button");

topLink?.addEventListener("click", (event) => {
  const target = document.querySelector(topLink.getAttribute("href"));
  if (!target) return;
  event.preventDefault();
  target.scrollIntoView({ behavior: "smooth", block: "start" });
});
