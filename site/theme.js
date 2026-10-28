// Appliqué avant l'affichage pour éviter un flash de mauvais thème.
try {
  const theme = JSON.parse(localStorage.getItem("pd.theme"));
  if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;
} catch (e) {}
