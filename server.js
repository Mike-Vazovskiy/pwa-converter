const express = require('express');
const multer = require('multer');
const unzipper = require('unzipper');
const archiver = require('archiver');
const fs = require('fs-extra');
const path = require('path');

const app = express();
const upload = multer({ dest: 'uploads/' });

const PORT = 3000;

// Middleware для обслуживания статических файлов
app.use(express.static('public'));

// Функция для создания manifest.json
function createManifest(iconPath) {
  return {
    name: "My PWA",
    short_name: "PWA",
    start_url: "./index.html",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#000000",
    icons: [
      {
        src: iconPath,
        sizes: "192x192",
        type: "image/png"
      },
      {
        src: iconPath,
        sizes: "512x512",
        type: "image/png"
      }
    ]
  };
}

// Функция для поиска index.html в распакованных файлах
function findIndexHtml(dir) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory()) {
      const found = findIndexHtml(fullPath);
      if (found) return found;
    } else if (file === 'index.html') {
      return fullPath;
    }
  }
  return null;
}

// Обработка загрузки zip-архива и иконки
app.post('/convert-to-pwa', upload.fields([{ name: 'siteZip' }, { name: 'icon' }]), (req, res) => {
  if (!req.files['siteZip'] || !req.files['icon']) {
    console.error('Missing required files.');
    return res.status(400).send('Missing required files.');
  }

  const zipPath = req.files['siteZip'][0].path;
  const iconPath = req.files['icon'][0].path;
  console.log(`Received zip file: ${zipPath}`);
  console.log(`Received icon file: ${iconPath}`);

  fs.createReadStream(zipPath)
    .pipe(unzipper.Extract({ path: 'extracted/' }))
    .on('close', () => {
      console.log('Zip extraction completed.');
      const extractedPath = path.join(__dirname, 'extracted');

      // Поиск index.html в распакованных файлах
      const indexPath = findIndexHtml(extractedPath);
      if (indexPath) {
        console.log(`Found index.html at: ${indexPath}`);
        const indexDir = path.dirname(indexPath);

        try {
          // Переименование иконки
          const newIconPath = path.join(indexDir, 'icon.png');
          fs.copyFileSync(iconPath, newIconPath); // Копируем иконку в ту же папку с новым именем

          // Создание manifest.json
          const manifest = createManifest('icon.png'); // Указываем новое имя иконки
          fs.writeFileSync(path.join(indexDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
          console.log('Created manifest.json');

          // Модификация HTML-файлов
          let htmlContent = fs.readFileSync(indexPath, 'utf8');

          // Добавление ссылки на manifest.json
          htmlContent = htmlContent.replace('</head>', '<link rel="manifest" href="manifest.json"></head>');
          console.log('Updated index.html with manifest link.');

          // Добавление кода для регистрации Service Worker
          const swScript = `
          <script>
            if ('serviceWorker' in navigator) {
              window.addEventListener('load', () => {
                navigator.serviceWorker.register('sw.js')
                  .then(registration => {
                    console.log('Service Worker registered with scope:', registration.scope);
                  })
                  .catch(error => {
                    console.error('Service Worker registration failed:', error);
                  });
              });
            }
          </script>
          `;
          htmlContent = htmlContent.replace('</body>', `${swScript}</body>`);
          fs.writeFileSync(indexPath, htmlContent);
          console.log('Updated index.html with Service Worker registration.');

          // Создание Service Worker
          const swContent = `
            self.addEventListener('install', event => {
              event.waitUntil(
                caches.open('my-cache').then(cache => {
                  return cache.addAll([
                    '/',
                    '/index.html',
                    '/manifest.json',
                    // Добавьте другие ресурсы, которые нужно кэшировать
                  ]);
                })
              );
            });

            self.addEventListener('fetch', event => {
              event.respondWith(
                caches.match(event.request).then(response => {
                  return response || fetch(event.request);
                })
              );
            });
          `;
          fs.writeFileSync(path.join(indexDir, 'sw.js'), swContent);
          console.log('Created sw.js');

          // Упаковка модифицированных файлов в zip-архив
          const archive = archiver('zip');
          res.attachment('modified-site.zip');
          archive.pipe(res);
          archive.directory(extractedPath + '/', false);
          archive.finalize().then(() => {
            console.log('Zip archive created and sent to client.');

            // Очищаем папку uploads
            fs.emptyDirSync('uploads');
            fs.removeSync('extracted'); // Удаляем временные файлы
          });
        } catch (error) {
          console.error('Error while processing the index.html or creating files:', error);
          return res.status(500).send('Error while processing the index.html or creating files.');
        }
      } else {
        console.error('index.html not found in the extracted files.');
        return res.status(400).send('index.html not found in the uploaded zip file.');
      }
    })
    .on('error', (err) => {
      console.error('Error during zip extraction:', err);
      res.status(500).send('Error while processing the zip file.');
    });
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});