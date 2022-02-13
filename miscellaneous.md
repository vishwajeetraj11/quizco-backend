Free a port in MAC.

-   sudo lsof -i :<port>
-   kill -9 <pid>

### Setting up linting.

https://blog.bitsrc.io/how-to-set-up-node-js-application-with-eslint-and-prettier-b1b7994db69f

### Build Successful but Server gave 503

#### Saying -> TypeError: Cannot assign to read only property 'map' of object '#<QueryCursor>'

```
Node.js v17.5.0
2022-02-11T14:00:42.029541+00:00 heroku[web.1]: Process exited with status 1
2022-02-11T14:00:42.099303+00:00 heroku[web.1]: State changed from starting to crashed
2022-02-11T14:00:42.103841+00:00 heroku[web.1]: State changed from crashed to starting
2022-02-11T14:00:45.020805+00:00 heroku[web.1]: Starting process with command `npm start`
2022-02-11T14:00:46.267087+00:00 app[web.1]:
2022-02-11T14:00:46.267114+00:00 app[web.1]: > quiz-app-backend@1.0.0 start
2022-02-11T14:00:46.267114+00:00 app[web.1]: > node src/app.js
2022-02-11T14:00:46.267115+00:00 app[web.1]:
2022-02-11T14:00:46.685242+00:00 app[web.1]: /app/node_modules/mongoose/lib/cursor/QueryCursor.js:150
2022-02-11T14:00:46.685264+00:00 app[web.1]: QueryCursor.prototype.map = function(fn) {
2022-02-11T14:00:46.685265+00:00 app[web.1]: ^
2022-02-11T14:00:46.685265+00:00 app[web.1]:
2022-02-11T14:00:46.685266+00:00 app[web.1]: TypeError: Cannot assign to read only property 'map' of object '#<QueryCursor>'
2022-02-11T14:00:46.685266+00:00 app[web.1]: at Object.<anonymous> (/app/node_modules/mongoose/lib/cursor/QueryCursor.js:150:27)
2022-02-11T14:00:46.685267+00:00 app[web.1]: at Module._compile (node:internal/modules/cjs/loader:1097:14)
2022-02-11T14:00:46.685267+00:00 app[web.1]: at Object.Module._extensions..js (node:internal/modules/cjs/loader:1151:10)
2022-02-11T14:00:46.685267+00:00 app[web.1]: at Module.load (node:internal/modules/cjs/loader:975:32)
2022-02-11T14:00:46.685267+00:00 app[web.1]: at Function.Module._load (node:internal/modules/cjs/loader:822:12)
2022-02-11T14:00:46.685268+00:00 app[web.1]: at Module.require (node:internal/modules/cjs/loader:999:19)
2022-02-11T14:00:46.685268+00:00 app[web.1]: at require (node:internal/modules/cjs/helpers:102:18)
2022-02-11T14:00:46.685268+00:00 app[web.1]: at Object.<anonymous> (/app/node_modules/mongoose/lib/query.js:12:21)
2022-02-11T14:00:46.685268+00:00 app[web.1]: at Module._compile (node:internal/modules/cjs/loader:1097:14)
2022-02-11T14:00:46.685269+00:00 app[web.1]: at Object.Module._extensions..js (node:internal/modules/cjs/loader:1151:10)
2022-02-11T14:00:46.685269+00:00 app[web.1]: at Module.load (node:internal/modules/cjs/loader:975:32)
2022-02-11T14:00:46.685269+00:00 app[web.1]: at Function.Module._load (node:internal/modules/cjs/loader:822:12)
2022-02-11T14:00:46.685270+00:00 app[web.1]: at Module.require (node:internal/modules/cjs/loader:999:19)
2022-02-11T14:00:46.685270+00:00 app[web.1]: at require (node:internal/modules/cjs/helpers:102:18)
2022-02-11T14:00:46.685270+00:00 app[web.1]: at Object.<anonymous> (/app/node_modules/mongoose/lib/index.js:27:15)
2022-02-11T14:00:46.685270+00:00 app[web.1]: at Module._compile (node:internal/modules/cjs/loader:1097:14)
2022-02-11T14:00:46.685275+00:00 app[web.1]:
2022-02-11T14:00:46.685275+00:00 app[web.1]: Node.js v17.5.0
2022-02-11T14:00:46.822694+00:00 heroku[web.1]: Process exited with status 1
2022-02-11T14:00:48.180926+00:00 heroku[web.1]: State changed from starting to crashed
```

#### Stackoverflow says. its node 17.x so downgrading.

[Stackoverflow Question](https://stackoverflow.com/questions/71073107/does-anyone-know-nay-fix-for-this-error-typeerror-cannot-assign-to-read-only-p/71073989).
