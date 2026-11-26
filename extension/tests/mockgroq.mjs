import http from "node:http";
export const stats = { calls: 0, byName: {} };
const rubric = { title: "Senior Java Developer", department: "Engineering", seniority: "senior", mustHaveSkills: ["Java", "Kubernetes"], importantSkills: ["Kafka"], niceToHaveSkills: [], skillMinYears: [], skillAliases: [{ skill: "Java", aliases: ["Spring Boot"] }], minExperienceYears: 5, maxExperienceYears: 9, maxNoticePeriodDays: 30, ctcBudgetMinLpa: -1, ctcBudgetMaxLpa: 40, education: "", educationRequired: false, certifications: [], industries: [], companyTypes: [], responsibilities: [], dealBreakers: [], locations: ["Bangalore"], remotePolicy: "hybrid", domainContext: "Payments platform", targetTitles: ["Java Developer"], searchVariants: [{ label: "Precise", keywords: "java kubernetes" }, { label: "Balanced", keywords: "java spring kubernetes" }, { label: "Wide", keywords: "backend engineer java" }], coreKeywords: ["java", "kubernetes"], booleanQuery: "(Java OR \"Spring Boot\") AND Kubernetes", mustHaveKeywords: ["Java", "Kubernetes"], excludeKeywords: [], minExp: 5, maxExp: 9 };
export function start(port) {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      if (req.url === "/__stats") { res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify(stats)); }
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const j = JSON.parse(body || "{}");
        const name = j.response_format?.json_schema?.name ?? "?";
        stats.calls++;
        stats.byName[name] = (stats.byName[name] ?? 0) + 1;
        const sys = j.messages[0].content, usr = j.messages[1].content;
        const N = Number(/EXACTLY (\d+) integers/.exec(sys)?.[1] ?? /\(0\.\.(\d+)\)/.exec(sys)?.[1] ?? 0);
        let out;
        if (name.startsWith("jd_rubric")) out = rubric;
        else if (name === "batch_candidate_facts") {
          const ids = [...usr.matchAll(/domId="([^"]+)"/g)].map((m) => m[1]);
          const cards = usr.split("<<<CARD").slice(1);
          out = { results: ids.map((id, i) => ({ domId: id, levels: Array.from({ length: N }, () => (cards[i].includes("Java") ? 2 : 0)), expYears: 6, noticePeriod: "30 days", noticeDays: 30, currentCtcLpa: 20, expectedCtcLpa: 28, location: "Bengaluru", fullName: (/^\s*([A-Z][a-z]+ [A-Z][a-z]+)/m.exec(cards[i]) ?? [])[1] ?? "Card Person", currentRole: "Java Developer", currentCompany: "Acme", headline: "", skills: ["Java"], oneLineVerdict: "Strong Java match" })) };
        } else if (name === "profile_audit") {
          out = { extracted: { fullName: (/^\s*([A-Z][a-z]+ [A-Z][a-z]+)/m.exec(usr.split('"""')[1] ?? "") ?? [])[1] ?? "Resume Person", currentRole: "Senior Engineer", currentCompany: "Acme", totalExpYears: 6, currentCtcLpa: 25, expectedCtcLpa: 32, noticePeriod: "30 days", noticeDays: 30, location: "Bengaluru", email: "", phone: "" }, checks: Array.from({ length: N }, (_, id) => ({ id, level: 2, evidence: "Spring Boot, EKS, Kafka at Acme" })), strengths: ["Strong Java"], risks: ["None"], gaps: [], noticeNote: "ok", ctcNote: "ok", experienceNote: "6 yrs", interviewQuestions: ["a", "b", "c"], verdict: "Good." };
        } else out = {};
        res.writeHead(200, { "content-type": "application/json", "x-ratelimit-remaining-requests": "100", "x-ratelimit-remaining-tokens": "50000" });
        res.end(JSON.stringify({ id: "x", object: "chat.completion", choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify(out) }, finish_reason: "stop" }] }));
      });
    });
    srv.listen(port, () => resolve(srv));
  });
}
