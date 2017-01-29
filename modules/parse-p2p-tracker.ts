function parseTracker(trackerLink: string) {
  let result = {
    type: "",
    host: "",
    port: 0
  };

  let announce = false;
  result.type = trackerLink.split(":")[0];
  result.host = trackerLink.split(":")[1];
  result.host = result.host.slice(2);
  let p       = trackerLink.split(":")[2];
  if (p !== undefined)
    result.port = Number(p.split("/")[0]);
  else
    result.port = 80;

  // result.host = trackerLink.split('/')[1];
  // result.host = trackerLink.slice(1);
  // if (result.host.indexOf('announce') > -1) {
  //   result.host = result.host.slice(-9);
  //   announce = true;
  // }
  // result.port = Number( result.host.split(':') );

  return result;

}

export default parseTracker;


// [ 'https://ashrise.com:443/phoenix/announce',
//   'udp://open.demonii.com:1337/announce',
//   'udp://tracker.ccc.de:80/announce',
//   'udp://tracker.openbittorrent.com:80/announce',
//   'udp://tracker.publicbt.com:80/announce',
//   'wss://tracker.btorrent.xyz',
//   'wss://tracker.fastcast.nz',
//   'wss://tracker.openwebtorrent.com' ]
