# 💬 Chat Local

Chat en tiempo real con cuentas de usuario, sala general, chats privados, fotos (galería y cámara), notas de voz, emojis, indicador de "escribiendo..." y confirmación de lectura (✓✓).

## Requisitos
- [Node.js](https://nodejs.org) 18 o superior (recomendado la versión LTS)
- Visual Studio Code

## Cómo ejecutarlo
1. Descomprime la carpeta `chat-local` y ábrela en VS Code (**Archivo → Abrir carpeta**).
2. Abre la terminal (**Terminal → Nueva terminal** o `Ctrl + ñ`).
3. Instala las dependencias (solo la primera vez):
   ```bash
   npm install
   ```
4. Inicia el servidor:
   ```bash
   npm start
   ```
   (o `npm run dev` para que se reinicie solo al guardar cambios en `server.js`)
5. Abre **http://localhost:3000** en el navegador.

## Probar con varias personas
- **En tu misma PC:** abre otra ventana en modo incógnito (`Ctrl + Shift + N`) o usa otro navegador, y crea otra cuenta.
  Así tienes dos usuarios distintos chateando a la vez.
- **Desde otro celular/PC en tu misma red Wi‑Fi:** al iniciar, la terminal muestra una dirección como
  `http://192.168.1.25:3000`. Ábrela desde el otro dispositivo.
  Si no carga, permite Node.js en el Firewall de Windows.

> ⚠️ El navegador solo permite **cámara y micrófono** en `localhost` o en sitios con HTTPS.
> Desde otro dispositivo por la IP local (http) el texto y las fotos de galería funcionan,
> pero la cámara y los audios pueden quedar bloqueados. Para eso más adelante se puede usar
> un túnel HTTPS (por ejemplo `ngrok` o `cloudflared`) o publicar el proyecto en un hosting.

## Estructura
```
chat-local/
├── server.js          ← servidor (API de usuarios + Socket.IO)
├── package.json
├── public/
│   ├── index.html     ← interfaz
│   ├── styles.css     ← diseño y animaciones
│   └── app.js         ← lógica del chat en el navegador
├── data/db.json       ← (se crea solo) usuarios y mensajes
└── uploads/           ← (se crea solo) fotos y audios enviados
```

## Funciones
- Crear cuenta / iniciar sesión (contraseñas cifradas con scrypt, sesión recordada)
- Sala general para todos + chats privados 1 a 1
- Lista de personas con estado **en línea / desconectado** en tiempo real
- Fotos desde la galería, desde la **cámara** (frontal/trasera) o pegadas con `Ctrl + V`, con comentario opcional
- **Notas de voz** con onda animada al grabar y reproductor propio
- Emojis, "escribiendo...", ✓ enviado / ✓✓ leído, contador de no leídos, sonido de aviso
- Foto de perfil (clic en tu avatar)
- Diseño responsive (funciona en celular)

## Reiniciar todo
Detén el servidor (`Ctrl + C`) y borra las carpetas `data/` y `uploads/`.
