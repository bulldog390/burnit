import React, { useState } from 'react';
import axios from 'axios';

function App() {
  const [selectedFile, setSelectedFile] = useState(null);
  const [expirySeconds, setExpirySeconds] = useState(60);
  const [shortLink, setShortLink] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  const handleFileChange = (event) => {
    setSelectedFile(event.target.files[0]);
  };

  const handleExpiryChange = (event) => {
    setExpirySeconds(event.target.value);
  };

  const handleUpload = async () => {
    if (!selectedFile) {
      setErrorMessage('Please select an image.');
      return;
    }

    const formData = new FormData();
    formData.append('image', selectedFile);
    formData.append('expirySeconds', expirySeconds);

    try {
      const response = await axios.post('/upload', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });

      if (response.data.success) {
        setShortLink(response.data.shortLink);
        setErrorMessage('');
      } else {
        setErrorMessage('Upload failed.');
      }
    } catch (error) {
      console.error('Upload error:', error);
      setErrorMessage('Upload failed.');
    }
  };

  return (
    <div>
      <h1>Self-Destructing Image Uploader</h1>
      <input type="file" onChange={handleFileChange} />
      <input
        type="number"
        value={expirySeconds}
        onChange={handleExpiryChange}
        placeholder="Expiry (seconds)"
      />
      <button onClick={handleUpload}>Upload</button>

      {errorMessage && <p style={{ color: 'red' }}>{errorMessage}</p>}

      {shortLink && (
        <div>
          <p>Short Link: <a href={shortLink} target="_blank" rel="noopener noreferrer">{shortLink}</a></p>
          <button onClick={() => navigator.clipboard.writeText(shortLink)}>Copy to Clipboard</button>
        </div>
      )}
    </div>
  );
}

export default App;
