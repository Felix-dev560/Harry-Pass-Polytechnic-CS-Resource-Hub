// The semester page was merged into the courses page (it now has a First / Second toggle).
// This keeps links that students already shared working: semester.html?level=3 opens courses.html?level=3.
const level = new URLSearchParams(location.search).get('level');
location.replace(/^[1-4]$/.test(level ?? '') ? `courses.html?level=${level}` : 'index.html');