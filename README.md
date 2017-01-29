# Empire [![travis][travis-image]][travis-url] [![npm][npm-image]][npm-url] [![Code Climate](https://codeclimate.com/github/CraigglesO/EmpireEngine/badges/gpa.svg)](https://codeclimate.com/github/CraigglesO/EmpireEngine) [![downloads][downloads-image]][downloads-url]

[travis-image]: https://travis-ci.org/CraigglesO/EmpireEngine.svg?branch=master
[travis-url]: https://travis-ci.org/CraigglesO/EmpireEngine
[npm-image]: https://img.shields.io/npm/v/empireengine.svg
[npm-url]: https://npmjs.org/package/empireengine
[downloads-image]: https://img.shields.io/npm/dm/empireengine.svg
[downloads-url]: https://npmjs.org/package/empireengine

### Let's build a connected world together

This is the underlining engine that fuels our P2P connections.

## Install

```
npm install EmpireJS
```

## Usage
```
import Empire from 'EmpireJS';


let E = new Empire();

```




#### Modules

These are the main modules that make up Empire:

| module | tests | version | description |
|---|---|---|---|
| **[EmpireEngine][EmpireEngine]** | [![][EmpireEngine-ti]][EmpireEngine-tu] | [![][empireengine-ni]][empireengine-nu] | **Torrent Client Engine (this module)**

| [bittorrent-dht][bittorrent-dht] | [![][bittorrent-dht-ti]][bittorrent-dht-tu] | [![][bittorrent-dht-ni]][bittorrent-dht-nu] | distributed hash table client


[EmpireEngine]: https://github.com/CraigglesO/EmpireEngine
[EmpireEngine-ti]: https://img.shields.io/travis/CraigglesO/EmpireEngine/master.svg
[EmpireEngine-tu]: https://travis-ci.org/CraigglesO/EmpireEngine
[empireengine-ni]: https://img.shields.io/npm/v/empireengine.svg
[empireengine-nu]: https://www.npmjs.com/package/empireengine

[bittorrent-dht]: https://github.com/feross/bittorrent-dht
[bittorrent-dht-ti]: https://img.shields.io/travis/feross/bittorrent-dht/master.svg
[bittorrent-dht-tu]: https://travis-ci.org/feross/bittorrent-dht
[bittorrent-dht-ni]: https://img.shields.io/npm/v/bittorrent-dht.svg
[bittorrent-dht-nu]: https://www.npmjs.com/package/bittorrent-dht
