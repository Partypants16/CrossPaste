import pathlib
idx_path = r'C:\Users\parth\OneDrive - Monash University\Personal\Projects\crosspaste\public\index.html'
content = pathlib.Path(idx_path).read_text(encoding='utf-8')
# Find start of image panel section
start_tag = '<section class="panel image-panel"'
search_start = content.find(start_tag)
if search_start==-1:
    print('Section not found')
    exit(1)
# Insert wrapper div before start tag
new_content = content[:search_start] + '\n<div class="media-panel-top">\n' + content[search_start:]
# Find closing </section> after image panel start
close_tag = '</section>'
end_index = new_content.find(close_tag, search_start)
if end_index==-1:
    print('Closing tag not found')
    exit(1)
# Insert closing wrapper before closing section tag
new_content = new_content[:end_index] + '\n</div>' + new_content[end_index:]
# Insert bottom panel before the original </section>
end_section_index = new_content.find(close_tag)
if end_section_index==-1:
    print('Closing section not found after insertion')
    exit(1)
bottom_panel = ('\n<div class="media-panel-bottom">\n  <div class="toolbar" role="toolbar">\n    <button type="button" class="toolbar-button" id="upload-file-button">Upload File</button>\n    <button type="button" class="toolbar-button" id="download-file-button">Download</button>\n    <button type="button" class="toolbar-button toolbar-button--danger" id="delete-file-button">Delete</button>\n  </div>\n  <ul id="file-list" class="file-grid"></ul>\n</div>')
# Insert before end_section_index
new_content = new_content[:end_section_index] + bottom_panel + new_content[end_section_index:]
# Write back
pathlib.Path(idx_path).write_text(new_content, encoding='utf-8')
print('Modified index.html successfully.')