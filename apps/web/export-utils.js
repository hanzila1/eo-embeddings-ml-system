(function attachExportUtils(globalScope) {
  function slugifyProjectName(value) {
    const slug = String(value || "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48)
      .replace(/-+$/g, "");
    return slug || "alphaearth";
  }

  function buildExportFilename({ projectName, year, kind, extension, date = new Date() }) {
    const parsedDate = date instanceof Date ? date : new Date(date);
    const dateStamp = Number.isNaN(parsedDate.getTime())
      ? "undated"
      : parsedDate.toISOString().slice(0, 10);
    const yearStamp = /^\d{4}$/.test(String(year)) ? String(year) : "year-unknown";
    const kindStamp = slugifyProjectName(kind || "export");
    const extensionStamp = String(extension || "json")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "") || "json";
    return `${slugifyProjectName(projectName)}-${yearStamp}-${kindStamp}-${dateStamp}.${extensionStamp}`;
  }

  globalScope.EoExportUtils = Object.freeze({ buildExportFilename, slugifyProjectName });
})(typeof window === "undefined" ? globalThis : window);
