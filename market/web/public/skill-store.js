/**
 * Client-side skill market store: fetch skills.json + chunks once, merge and cache.
 * Used by both the list page and the detail shell so data is loaded only once per session.
 */
(function () {
  function displayBranch(repo) {
    return repo && repo.branch ? repo.branch : "main";
  }

  function buildDetailsUrl(repoId, repo, skillPath) {
    const parts = repoId.split("/");
    const owner = parts[0] || "";
    const repository = parts[1] || "";
    return "https://github.com/" + owner + "/" + repository + "/blob/" + displayBranch(repo) + "/" + skillPath + "/SKILL.md";
  }

  var cdnBaseUrl = "https://cdn.skillmarket.cc";

  function expandSkill(skill, repos) {
    var repo = (repos && repos[skill.repo]) || { url: "https://github.com/" + skill.repo };
    var zipBase = cdnBaseUrl + "/zips";
    var ownerRepo = skill.repo.split("/");
    var owner = ownerRepo[0] || "";
    var repository = ownerRepo[1] || "";
    var safeName = (skill.name || "").replace(/[^a-zA-Z0-9-_]/g, "");
    var skillZipUrl = zipBase + "/" + owner + "-" + repository + "-" + safeName + ".zip";
    return {
      id: skill.id,
      name: skill.name,
      description: skill.description,
      categories: skill.categories,
      author: skill.author,
      repo: skill.repo,
      path: skill.path,
      commitHash: skill.commitHash,
      version: skill.version,
      tags: skill.tags,
      compatibility: skill.compatibility,
      files: skill.files,
      repoUrl: repo.url || "https://github.com/" + skill.repo,
      branch: displayBranch(repo),
      detailsUrl: buildDetailsUrl(skill.repo, repo, skill.path),
      skillZipUrl: skillZipUrl,
      stars: repo.stars != null ? repo.stars : 0,
      forks: repo.forks != null ? repo.forks : 0,
      lastUpdated: repo.lastUpdated != null ? repo.lastUpdated : null,
    };
  }

  var skills = [];
  var repositories = {};
  var loadPromise = null;
  var loaded = false;

  var LOCAL_DATA_BASE = "/data";

  function fetchOrNull(url) {
    return fetch(url).then(function (r) { return r.ok ? r : null; }).catch(function () { return null; });
  }

  function load(cdnBase) {
    if (cdnBase) cdnBaseUrl = cdnBase.replace(/\/$/, "");
    if (loaded && skills.length > 0) {
      return Promise.resolve();
    }
    if (loadPromise) {
      return loadPromise;
    }
    var cdnBase = cdnBaseUrl;
    loadPromise = (async function () {
      var mainResp = await fetchOrNull(cdnBase + "/skills.json");
      if (!mainResp) {
        mainResp = await fetchOrNull(LOCAL_DATA_BASE + "/skills.json");
      }
      if (!mainResp) throw new Error("Failed to fetch skills.json (CDN and local)");
      var mainData = await mainResp.json();
      skills = (mainData.skills || []).slice();
      repositories = {};
      for (var k in mainData.repositories || {}) repositories[k] = mainData.repositories[k];
      var chunks = mainData.meta && mainData.meta.chunks ? mainData.meta.chunks : [];
      for (var i = 0; i < chunks.length; i++) {
        var chunkResp = await fetchOrNull(cdnBase + "/" + chunks[i]);
        if (!chunkResp) chunkResp = await fetchOrNull(LOCAL_DATA_BASE + "/" + chunks[i]);
        if (!chunkResp) {
          console.warn("skill-store: failed to load chunk " + chunks[i] + " (CDN and local)");
          continue;
        }
        try {
          var chunkData = await chunkResp.json();
          skills = skills.concat(chunkData.skills || []);
          for (var r in chunkData.repositories || {}) repositories[r] = chunkData.repositories[r];
        } catch (e) {
          console.warn("skill-store: failed to parse chunk " + chunks[i], e);
        }
      }
      loaded = true;
    })();
    return loadPromise;
  }

  function getSkillById(id) {
    if (!id) return null;
    for (var i = 0; i < skills.length; i++) {
      if (skills[i].id === id) return expandSkill(skills[i], repositories);
    }
    return null;
  }

  function getAllSkills() {
    return skills;
  }

  function getRepositories() {
    return repositories;
  }

  function isLoaded() {
    return loaded;
  }

  window.__skillStore = {
    load: load,
    getSkillById: getSkillById,
    getAllSkills: getAllSkills,
    getRepositories: getRepositories,
    isLoaded: isLoaded,
    expandSkill: expandSkill,
  };
})();
