data:  <Buffer 13 42 69 74 54 6f 72 72 65 6e 74 20 70 72 6f 74 6f 63 6f 6c 00 00 00 00 00 10 00 05 29 41 50 cb 4b eb 75 85 d8 9d 5f af 44 71 21 fe e5 36 0d 82 2d 4c ... >
datalength:  68
data:  <Buffer 00 00 00 01 02>
datalength:  5
interested
data:  <Buffer 00 00 00 01 01>
datalength:  5
unchoked
data:  <Buffer 00 00 00 0d 06 00 00 00 04 00 00 00 00 00 00 40 00 00 00 00 0d 06 00 00 00 05 00 00 00 00 00 00 40 00>
datalength:  34


INFOHASH FOR THIS EXAMPLE: 294150cb4beb7585d89d5faf447121fee5360d82

IF IM THE USER WITH DATA:
First send handshakes and bitfield
reply: interested
Then send an interested
reply: unchoked
then send a unchoked
reply: package requests..

ex of package request:
00 00 00 0d - 13 bytes long
06 - request code
13 bytes left:
index:  00 00 00 04
begin:  00 00 00 00
length: 00 00 40 00

send two for a queue:
00 00 00 0d - 14 bytes long
06 - request code
index:  00 00 00 05
begin:  00 00 00 00
length: 00 00 40 00







==================================================================







FIRST RESPONCE
13 42 69 74 54 6f 72 72 65 6e
74 20 70 72 6f 74 6f 63 6f 6c
00 00 00 00 00 10 00 05 29 41
50 cb 4b eb 75 85 d8 9d 5f af
44 71 21 fe e5 36 0d 82 2d 4c
54 31 30 30 30 2d 29 49 4a 71
39 31 70 79 74 5f 79 6a 00 00
00 0a 05 ff ff ff ff ff ff ff
ff f8

IF IM THE USER IN NEED OF DATA:
1) Send handshake
2) get a return handshake and the bitfield
3) send an interested
4) get an unchoked
5) send an unchoked
6) This is where we send requests...

a request should be given a piece and the data going with the piece :D YAY SUCCESS









================ UT_METADATA ======================
1) traditional handshake
2) extension protocol
3) bitfield
00 00 00 fb 14  length of fb and 14 (20 in dec)
00
64 31 3a 65 69 30 65 .. data

uTorrent:
{ e: 0,
  ipv4: <Buffer 4c 04 0b ec>,
  ipv6: <Buffer fe 80 00 00 00 00 00 00 08 32 01 ea 3f 1e 44 df>,
  complete_ago: 43,
  m:
   { upload_only: 3,
     ut_holepunch: 4,
     ut_metadata: 2,
     ut_pex: 1,
     ut_recommend: 5,
     ut_comment: 6 },
  metadata_size: 18716,
  p: 35557,
  reqq: 255,
  v: <Buffer c2 b5 54 6f 72 72 65 6e 74 20 4d 61 63 20 31 2e 38 2e 37>,
  yourip: <Buffer 7f 00 00 01> }

  webTorrent:
  { m: { ut_metadata: 1, ut_pex: 2 }, metadata_size: 13143 }



  STEPS:
  1) Ensure your reserved bit is set
  2) When you recieve a handshake you will also recieve extension info (see above) AND bitfield.
  3) You must first suggest interest and unchoke
  4) once you are unchoked you send a metadata handshake:
  let msg1 = {'m': {'ut_metadata': 3} };
  // This ensures that the other user is aware of which number to send ut_metadata to
  5) Request metadata:
  let msg2 = { "msg_type": 0, "piece": 0 };
  6) your response will be something like this:
  { msg_type: 1, piece: 0, total_size: 215 } .. #(*Y) data follows.

  WHAT THE DATA MAY LOOK LIKE:
  { files:
   [ { length: 1346194, path: [Object] },
     { length: 215911, path: [Object] } ],
  name: <Buffer 72 65 61 73 65 61 72 63 68>,
  'piece length': 16384,
  pieces: <Buffer 89 0d 3e 6e d5 d5 4b d2 10 db 86 ad 75 9b 09 2d 1c 24 83 53 3c 89 92 44 80 5c 7f f7 2f 88 60 e4 8a 04 3a 0e e1 d2 ae 3d 85 8e 25 fe 03 1c 2a 0f 55 7f ... > }

  NOTICE: SOMETIMES 'files' is not included
