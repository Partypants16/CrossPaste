import pathlib
path = r'C:\Users\\parth\\OneDrive - Monash University\\Personal\\Projects\\crosspaste\\public\\styles\\main.css'
new_rules = '''/* Media panel split using flexbox/grid */
.media-panel {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
@media (min-width: 768px) {
  .media-panel { flex-direction: row; }
}
/* File list container */
.file-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px,1fr));
  gap: var(--space-2);
}
/* File card styles */
.file-card {
  background: var(--color-panel);
  border: 1px solid var(--color-border);
  padding: var(--space-2) var(--space-3);
  display:flex;
  justify-content: space-between;
  align-items:flex-start;
  gap: var(--space-2);
}
.file-card__details{ flex:1; display:flex; flex-direction:column; gap:.2rem; }
.file-card__title { font-weight:500; color:var(--color-text); }
.badge{ background:var(--color-accent); color:white; border-radius:999px; padding:.2em .5em; font-size:.8rem; }
.actions-group{ display:flex; gap:var(--space-1); align-items:center; }
.action-icon{ cursor:pointer; color:var(--color-text-muted); transition:color .2s; }
.action-icon:hover{ color:var(--color-danger); }
@media (max-width:640px){ .media-panel{ flex-direction:column; } }
'''

# Append new rules to the CSS file
content = pathlib.Path(path).read_text(encoding='utf-8')
pathlib.Path(path).write_text(content + '\n' + new_rules, encoding='utf-8')
print('CSS updated')
