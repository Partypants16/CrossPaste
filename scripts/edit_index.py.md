import pathlib, re
idx_path = r'C:\Users\parth\OneDrive - Monash University\Personal\Projects\crosspaste\public\index.html'
content = pathlib.Path(idx_path).read_text(encoding='utf-8')
# Find start of image panel section
start_tag = '<section class="panel image-panel"
search_start = content.find(start_tag)
if search_start==-1:
    print('Section not found')
    exit(1)
# Insert wrapper div before start tag
new_content = content[:search_start] + '\n<div class="media-panel-top">\n' + content[search_start:]
# Find closing </section> after that start index
close_tag = '</section>'
# We need to find matching close for image panel; since it contains nested sections? there is only one section end.
end_index = new_content.find(close_tag, search_start)
if end_index==-1:
    print('Closing tag not found')
    exit(1)
# Insert closing wrapper before closing section tag
new_content = new_content[:end_index] + '\n</div>' + new_content[end_index:]
# Now insert the bottom panel after that.
# Find index of inserted closing </div> for media-panel-top; it is at end_index (position where we inserted); but there might be other </div>s after.
# Let's directly add bottom panel after the original section close, before the existing </section>. We'll use the new position of </section> maybe changed? It's still same because we didn't touch beyond.
# Determine index of image-panel closing > should be at end_index+len('</div>')? Actually we inserted </div> just before earlier close_tag; so closing section is after that insertion. The sequence now: ...<div class="media-panel-top">...image panel...</div></section>
# We'll insert bottom panel right before the existing </section>. That's at end_index+len('</div>') maybe? But easier: find '</section>' again in new_content.
end_section_index = new_content.find(close_tag)
if end_section_index==-1:
    print('Closing section not found after insertion')
    exit(1)
bottom_panel = '\n<div class="media-panel-bottom">\n  <div class="toolbar" role="toolbar">\n    <button type="button" class="toolbar-button" id="upload-file-button">Upload File</button>\n    <button type="button" class="toolbar-button" id="download-file-button">Download</button>\n    <button type="button" class="toolbar-button toolbar-button--danger" id="delete-file-button">Delete</button>\n  </div>\n  <ul id="file-list" class="file-grid"></ul>\n</div>'
# Insert before end_section_index
new_content = new_content[:end_section_index] + bottom_panel + new_content[end_section_index:]
# Write back
pathlib.Path(idx_path).write_text(new_content, encoding='utf-8')
print('Modified index.html successfully.')