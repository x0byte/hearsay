# Hearsay

Prototype of a voice-controlled visual whiteboard. For now it is just a
full-window [tldraw](https://tldraw.dev) canvas that saves to the browser.

## Run

```sh
npm install
npm run dev     # start the dev server
npm run build   # type-check and build for production
```

## Layout

- `src/main.tsx` – mounts React into `index.html`
- `src/App.tsx` – renders the tldraw canvas (with local persistence)
- `src/index.css` – makes the page fill the window
