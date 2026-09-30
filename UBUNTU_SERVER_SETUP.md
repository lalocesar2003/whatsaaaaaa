# 🖥️ Guía de Instalación en Ubuntu Server (Laptop Servidor 24/7)

Esta guía explica cómo configurar el bot en tu laptop antigua con **Ubuntu Server** para que funcione de manera ininterrumpida las 24 horas del día, **sin que se suspenda al cerrar la pantalla** y **sin volver a pedirte el código QR nunca más**.

---

## ⚡ Paso 1: Evitar que la laptop se suspenda al cerrar la tapa

En Ubuntu Server, al cerrar la pantalla de una laptop, el sistema entra en modo suspensión por defecto. Para que funcione 24/7 con la tapa cerrada:

1. Abre el archivo de configuración del sistema:
   ```bash
   sudo nano /etc/systemd/logind.conf
   ```

2. Busca o añade las siguientes líneas (asegúrate de quitar el símbolo `#` al inicio si están comentadas):
   ```ini
   HandleLidSwitch=ignore
   HandleLidSwitchExternalPower=ignore
   HandleLidSwitchDocked=ignore
   ```

3. Guarda los cambios con `Ctrl + O`, presiona `Enter` y sal con `Ctrl + X`.

4. Aplica los cambios reiniciando el servicio de energía:
   ```bash
   sudo systemctl restart systemd-logind
   ```
   *(Ahora puedes cerrar la tapa de la laptop y seguirá funcionando sin apagarse).*

---

## 📦 Paso 2: Instalar Node.js y librerías de Chromium

Ubuntu Server no incluye entorno gráfico (GUI). Para que Puppeteer y el navegador de WhatsApp Web funcionen sin errores en modo headless, instala las siguientes dependencias:

```bash
# 1. Actualizar repositorios
sudo apt update && sudo apt upgrade -y

# 2. Instalar herramientas básicas y Node.js LTS (v20 o v22)
sudo apt install -y curl git build-essential
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# 3. Instalar librerías de sistema necesarias para Chromium
sudo apt install -y \
  ca-certificates \
  fonts-liberation \
  libasound2t64 \
  libatk-bridge2.0-0 \
  libatk1.0-0 \
  libcairo2 \
  libcups2 \
  libdbus-1-3 \
  libexpat1 \
  libfontconfig1 \
  libgbm1 \
  libgtk-3-0 \
  libnspr4 \
  libnss3 \
  libpango-1.0-0 \
  libx11-6 \
  libx11-xcb1 \
  libxcb1 \
  libxcomposite1 \
  libxcursor1 \
  libxdamage1 \
  libxext6 \
  libxfixes3 \
  libxi6 \
  libxrandr2 \
  libxrender1 \
  libxss1 \
  libxtst6 \
  xdg-utils
```
*(Nota: En Ubuntu 24.04 `libasound2` se llama `libasound2t64`; si usas Ubuntu 22.04 cámbialo por `libasound2`).*

---

## 📂 Paso 3: Transferir el proyecto a tu laptop servidor

Desde tu computadora actual con Windows, puedes transferir la carpeta mediante **SCP** (PowerShell):

```powershell
# Reemplaza 'usuario' y '192.168.1.XX' por los datos de tu laptop Ubuntu
scp -r "C:\Users\cesar\.gemini\antigravity\scratch\whatsapp-bot" usuario@192.168.1.XX:~/whatsapp-bot
```

*(O si prefieres, puedes subir el proyecto a un repositorio privado de GitHub y clonarlo con `git clone` en la laptop).*

---

## 📲 Paso 4: Instalar dependencias y escanear el QR inicial

1. Conéctate a tu laptop por SSH y entra a la carpeta:
   ```bash
   cd ~/whatsapp-bot
   ```

2. Instala los paquetes de Node:
   ```bash
   npm install
   ```

3. Ejecuta el script de forma manual la **primera vez** para escanear el código QR:
   ```bash
   node index.js
   ```

4. Verás el código QR en la pantalla de la terminal. Abre WhatsApp en tu celular:
   - Ve a **Ajustes > Dispositivos vinculados > Vincular un dispositivo**.
   - Escanea el código QR.
5. Verás en la terminal:
   ```text
   🔐 [WhatsApp] Sesión autenticada y credenciales sincronizadas con éxito.
   ✅ [WhatsApp] Conexión establecida y lista para operar 24/7.
   ```
6. Presiona `Ctrl + C` para detener esta prueba inicial. La sesión ya quedó guardada de forma permanente en la carpeta `.wwebjs_auth`.

---

## 🛡️ Paso 5: Dejar el bot corriendo 24/7 con PM2

Para que el bot nunca se detenga, siga funcionando al cerrar la sesión SSH y arranque solo si hay un corte de luz o se reinicia la laptop, usaremos **PM2** (el gestor de procesos estándar de Node.js):

1. Instala PM2 globalmente:
   ```bash
   sudo npm install -g pm2
   ```

2. Inicia el bot como servicio en segundo plano:
   ```bash
   cd ~/whatsapp-bot
   pm2 start index.js --name "whatsapp-bot"
   ```

3. Configura PM2 para que inicie automáticamente con el sistema:
   ```bash
   pm2 startup
   ```
   *(Copia y pega el comando `sudo env PATH=...` que te indique la terminal).*

4. Guarda el estado actual:
   ```bash
   pm2 save
   ```

---

## 📊 Comandos útiles para monitorear tu servidor

- **Ver el estado del bot en tiempo real**:
  ```bash
  pm2 status
  ```

- **Ver los mensajes enviados, pausas y próximas horas programadas**:
  ```bash
  pm2 logs whatsapp-bot
  ```

- **Reiniciar el bot si modificas `config.js`**:
  ```bash
  pm2 restart whatsapp-bot
  ```

- **Revisar el historial de números enviados**:
  ```bash
  cat ~/whatsapp-bot/historial.json
  ```
