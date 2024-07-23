

console.log('page refresh')

let local = "http://127.0.0.1:5500"
//let local = "http://192.168.1.163:8082"




//routing buttons ----------------------------------------------------------------------------------------------------

let logoButton = () => {
  location.assign(local)
  console.log('open active menu')
  }

let menuButton = () => {
const element = document.getElementById('0')
element.classList.contains("nav-moblie") ? element.classList.remove("nav-moblie") : element.classList.add("nav-moblie");
console.log('open active menu')
}


let serviceButton = async () => {
location.assign(`${local}/index.html#1`)
console.log('go to services')
}



let aboutButton = () => {
location.assign(`${local}/index.html#1`)
console.log('go to about us')
}


let faqButton = () => {
location.assign(`${local}/index.html#1`)
console.log('go to FAQ')
}


let callButton = () => {
  window.open('tel:6782079719', '_self');
  console.log('set up call')
  }

  let emailButton = () => {
    window.open('tel:6782079719', '_self');
    console.log('set up call')
    }
  









