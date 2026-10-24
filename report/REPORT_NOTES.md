# BAC Maps report: notes for the team

`main.tex` builds `main.pdf` (56 pages). Build it with Tectonic, or with pdfLaTeX or XeLaTeX on Overleaf:

```
tectonic main.tex
```

Diagrams are in `diagrams/` (TikZ). Screenshots are in `figures/`, and `figures/tour/` holds all 41 screenshots of the React build. Raw test results from 24 October 2026 are in `evidence/`. Code listings are read directly from the source files (`../web`, `../frontend`, `../server`), so they always match the code. If a listed file changes, check its line numbers in `main.tex`.

## Section order

The chapters and sections follow "5 Report Structure.pdf" in order:

1. Cover, Declaration, Acknowledgements, Abstract, Table of Contents, List of Figures, List of Tables (plus a list of listings).
2. Chapter 1 has sections 1.1 to 1.7 exactly as listed.
3. Chapter 2 holds the critical review and a comparison table.
4. Chapter 3 contains, in the lecturer's order, research design with:
   - data collection and sources;
   - rationale for secondary data;
   - selection criteria;
   - analysis procedures;
   - data quality.

   It then covers sampling or feature selection (the requirements catalogue), data analysis techniques, and ethical considerations.
5. Chapter 4 covers key findings, data interpretation, and the link to the research questions.
6. Chapter 5 covers critical discussion, comparison with previous studies, and unexpected results.
7. Chapter 6 covers summary, contributions, practical implications, limitations, and recommendations.
8. References, then Appendices A to C.

## Requirements catalogue (20 features)

The camera system (old FR-07, FR-08 and FR-09) was not built. It is listed as descoped in Table 3.3 with its reason. The catalogue now has 20 functional requirements drawn from what the application does, FR-01 to FR-20 (Table 3.2). Each one keeps a link to the old requirement it replaces.

Status (Table 4.6):
- 16 are met.
- 4 are partly met:
  - FR-11, location: not tried on a real phone;
  - FR-15, sign-in: demo accounts only;
  - FR-18, next class: shown in the profile, not highlighted on the map;
  - FR-20, staff edits: saved in one browser only.

## Checklist coverage

| Checklist item | Where covered | Status |
|---|---|---|
| Final code committed and pushed; commit hash recorded | 3.1 (react-frontend `bb8fe1b`, main `f363c57`) | Needs my input: committed, not pushed (you chose "commit only") |
| No "being rebuilt" or route computation as future work | 4.1.2 to 4.1.3; routes are presented as done | Done |
| Architecture, design and technology include Pathfinder, both adapters, room data, drawings | Figure 3.1, 3.1.1, NFR-08 | Done |
| Route algorithm explained | 4.1.3, Eq. 4.1, Listing 4.3 | Done |
| Counts and service-worker version match the code | 40 rooms, 22 buildings, 10 walks, 5 groups, 40 classes, cache v9 with 26 files | Done |
| Old Eq. 2.3 not presented as how the map is drawn | Eq. 3.1 is the drawing alignment, stated as not drawing the map | Done |
| Listings exact | Listings 4.1 to 4.6 are read straight from the source with line numbers | Done |
| Measurable objectives | 1.3, O1 to O5 | Done |
| Status table FR and NFR | Table 4.6 (FR-01 to FR-20, NFR-01 and NFR-03 to NFR-10) | Done |
| Dropped Musts justified | 3.2.1, Table 3.3 | Needs my input: confirm the team's own reason |
| FR-03, FR-04 and FR-11 corrected | Now FR-16/17 (met), FR-18 (partly), FR-20 (partly) | Done |
| Conclusion verdict per objective | 6.1 | Done |
| Limitations and future work current | 6.4, 6.5 | Done |
| Suites run with date, environment and results | 4.1.8, Table 4.2 | Done |
| NFR-01 timings | Table 4.4 | Done |
| Wrong-password and cross-account tests | Table 4.5 | Done |
| Offline and install tested or marked | 4.1.9 (offline tested; install marked not tested) | Done |
| Pass/Fail/Partly used with correct mappings | Table 4.3 | Done |
| Phone: real or emulated stated | 4.1.8, Figure 4.5 caption, NFR-03 | Done |
| Abstract | Front matter | Done |
| Methodology, timeline, team contributions | Chapter 3; Table 3.1 | Needs my input: timeline and contributions |
| Use case and activity diagrams match, planned items marked | Figures 3.2 and 3.3 (dashed = planned, partial or descoped) | Done |
| ER diagram | Figure 3.4 (the real SQLite tables) | Done |
| Class diagram legible with correct title | Replaced by the component architecture (Figure 3.1) and the code structure (Figure 4.10); the code has no classes to draw | Needs my input: say if your lecturer requires a class diagram |
| Full-resolution screenshots | `figures/`, 1440x900 and 390x844 at 2x | Done |
| Appendices filled or removed | A Abbreviations, B Requirement cards, C Test commands | Done |
| Full Harvard references checked by the team | References: 15 entries, DOIs checked on Crossref and IEEE Xplore | Needs my input: team check |
| No "n.d.a, n" or "the supplied literature" | None left | Done |
| One product name; abbreviations listed | "BAC Maps" throughout, BSBS mentioned once (1.1); Appendix A | Done |
| fi/fl intact | Checked in the PDF text: 182 fi/fl words, no broken ligatures | Done |
| Page numbers in order; listings in their own list | Roman i to ix, arabic from Chapter 1; List of Listings | Done |
| Title page complete | Title, authors, module, institution, date | Needs my input: student IDs, date, supervisor |
| No internal-document references | None | Done |

## Conflicts between the guides, and what was done

1. The lecturer's structure lists the table of contents twice. It is included once, after the abstract, as in the template.
2. The lecturer's chapters are research-style, so the design, implementation and testing content sits in Chapters 3 and 4. Checklist items were applied by what they ask for, because their section numbers refer to the old report.
3. The template numbers every page, but the lecturer wants numbering to start at the Introduction. The front matter uses roman numerals, and arabic numbering starts at Chapter 1.
4. The lecturer's structure has no slot for abbreviations, so they are in Appendix A.
5. Additions to the template preamble (nothing in it was removed):
   - fonts that keep fi/fl searchable;
   - subcaption, listings, xcolor, tikz, natbib, array and booktabs;
   - "References" as the heading;
   - single spacing inside tables, captions and listings, and on the cover so that it fits on one page;
   - "Appendix" as the appendix heading.
6. Length: the 50-page limit excludes appendices. The numbered body plus references is 42 pages, or 52 PDF pages with the 10 front-matter pages. If your lecturer counts the front matter, the report is two pages over.
7. The checklist asks for a class diagram. The code has no class hierarchy, so the architecture diagram and code-structure diagram are given instead.

## Corrections to the old report's references

- **IEEE 11064653** is "Campus Navigation and Augmented Reality Guided Mobile Application" (Patel et al., 2025), not a paper on QR location fixes.
- **IEEE 8621924** is a Spring Boot REST API paper (Guntupally et al., 2018), not a microservices paper. It is cited only for the API between interface and database.
- **ResearchGate 356973212 and 372808760** could not be opened, because ResearchGate blocks automated access. They are left out. Send the titles if you want them back in.
- **Harvard campus map, Ex Libris and Architizer** were left out: no specific source could be identified or read.

## Compile warnings (Tectonic 0.17, XeTeX)

- No errors, no undefined references and no overfull lines.
- There are 27 "underfull" notices. These are loose spacing inside narrow table cells and listing captions. They do not affect content.
- "Fontconfig error: cannot load default config file" is a Tectonic message on Windows and does not affect the PDF.

## Test results behind the report

| Suite or check | Result |
|---|---|
| Engine and site suites | All 8 pass, 247 checks |
| e2e_core (older Pathfinder-page suite) | 21 passed, 4 failed, then stopped. The same happens on commit `fafb968` from before the merge |
| e2e_perf | Did not complete |
| Map ready, median of 5 runs | 1.4 s on a local server; 3.4 s with a simulated 4G-like connection and 4x CPU slowdown |
| Route | 93 ms on a local server; 484 ms on the slower profile |
| Floor change | 16 to 65 ms |
| Offline | Map and route work after one visit |
| Security checks | All pass |

## Placeholders to fill (search for `[INSERT`)

- Student IDs (5), submission date, supervisor (or delete that line)
- Signatures and date on the Declaration
- Acknowledgements
- Project timeline (3.1.2) and each member's contributions (Table 3.1)
- The team's own reason and date for descoping the camera (3.2.1)
- Whether the college gave permission to use the campus drawings and timetable (3.4)
- NFR-09: was the 16-week timeline met? (Table 4.6)
- Full name of SCIS (Appendix A)

## Questions

1. Is the title "BAC Maps: A Web-Based Campus Navigation System for Botswana Accountancy College" right?
2. Does your lecturer count front-matter pages towards the 50?
3. Do you need a class diagram, or does the architecture diagram cover it?
4. What are the titles of the two ResearchGate papers, if you want them cited?
5. May the branch be pushed, so the commit hash in 3.1 is on GitHub?
