// Utrullningens version, synlig i sidfoten på varje sida.
//
// Finns för att man ska kunna se om det man tittar på är det som senast
// pushades, eller en gammal kopia service workern serverar ur cachen. Utan den
// är "har det kommit ut?" en fråga man bara kan gissa svaret på.
//
// Höjs vid varje utrullning som ändrar något i public/. Samma sträng står i
// sw.js CACHE_VERSION, och tests/version.test.mjs ser till att de två aldrig
// glider isär – en cache som inte byts ut när sidan ändras är precis den sortens
// fel som ser ut som något annat.
export const VERSION = 'v24';
