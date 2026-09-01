from pathlib import Path

# Fix RealtimeMvpVisionDisplay handleSaveDocument
p = Path("src/app1/Components/RealtimeMvpVisionDisplay.jsx")
text = p.read_text(encoding="utf-8")
old = """      } else {
        result = await dispatch(saveGeneratedDocument(documentData)).unwrap();
        message.success("Document saved successfully!");
      }

      console.log("Result:", result);"""
new = """      } else {
        result = await dispatch(saveGeneratedDocument(documentData)).unwrap();
        message.success("Document saved successfully!");
      }

      setVersion(nextVersion);
      const savedDoc = result?.document || result;
      const savedHistory = parseStoredDocumentVersionHistory(savedDoc);
      if (savedHistory.length > 0) {
        setRevisionHistory(buildRevisionHistoryTableRows(savedHistory));
      } else {
        const historyForState = existingForMeeting?._id
          ? [
              ...(existingForMeeting.version_history || existingForMeeting.versionHistory || []),
              versionHistoryEntry,
            ]
          : [versionHistoryEntry];
        setRevisionHistory(buildRevisionHistoryTableRows(historyForState));
      }

      console.log("Result:", result);"""
if old not in text:
    raise SystemExit("handleSaveDocument block not found")
text = text.replace(old, new, 1)

old2 = """                </div>

                {/* Table of Contents */}"""
new2 = """                </div>

                {/* Revision History */}
                <div style={{ marginBottom: 40 }}>
                  <h2 style={{
                    fontSize: 18,
                    fontWeight: 'bold',
                    margin: '0 0 12px',
                    fontFamily: 'Georgia, serif',
                    color: isDarkMode ? '#f8fafc' : '#333',
                  }}>
                    Revision History
                  </h2>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'Georgia, serif' }}>
                    <thead>
                      <tr style={{ backgroundColor: isDarkMode ? '#334155' : '#D3D3D3' }}>
                        <th style={{ border: `1px solid ${isDarkMode ? '#64748b' : '#999'}`, color: isDarkMode ? '#f8fafc' : '#333', padding: '8px 12px', textAlign: 'center', width: '50%' }}>Date</th>
                        <th style={{ border: `1px solid ${isDarkMode ? '#64748b' : '#999'}`, color: isDarkMode ? '#f8fafc' : '#333', padding: '8px 12px', textAlign: 'center', width: '50%' }}>Revision</th>
                      </tr>
                    </thead>
                    <tbody>
                      {revisionHistory.map((row, idx) => (
                        <tr key={idx}>
                          <td style={{ border: `1px solid ${isDarkMode ? '#475569' : '#ccc'}`, color: isDarkMode ? '#f8fafc' : '#333', padding: '8px 12px', textAlign: 'center' }}>
                            {row.date}
                          </td>
                          <td style={{ border: `1px solid ${isDarkMode ? '#475569' : '#ccc'}`, color: isDarkMode ? '#f8fafc' : '#333', padding: '8px 12px', textAlign: 'center' }}>
                            {row.revision || `v${version || 1}`}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Table of Contents */}"""
if old2 not in text:
    raise SystemExit("preview TOC block not found")
text = text.replace(old2, new2, 1)
p.write_text(text, encoding="utf-8")
print("RealtimeMvpVisionDisplay updated")

# Fix template_document.py
p2 = Path("python_files/template_document.py")
t2 = p2.read_text(encoding="utf-8")
old3 = """        initial_version = data.get('version', 1)
        version_created_at = data.get('versionCreatedAt', datetime.utcnow().isoformat())
        document = {"""
new3 = """        initial_version = data.get('version', 1)
        version_created_at = data.get('versionCreatedAt', datetime.utcnow().isoformat())
        version_history = data.get('versionHistory') or data.get('version_history')
        if not version_history:
            version_history = [{'version': initial_version, 'createdAt': version_created_at}]
        document = {"""
if old3 not in t2:
    raise SystemExit("template_document insert block not found")
t2 = t2.replace(old3, new3, 1)
old4 = "            'version_history': [{'version': initial_version, 'createdAt': version_created_at}],\n        }"
new4 = "            'version_history': version_history,\n        }"
if old4 not in t2:
    raise SystemExit("template_document version_history line not found")
t2 = t2.replace(old4, new4, 1)
p2.write_text(t2, encoding="utf-8")
print("template_document updated")
