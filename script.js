

console.log('page refesh')


let menuButton = () => {
  const element = document.getElementById('0')

  element.classList.contains("nav-moblie") ? element.classList.remove("nav-moblie") : element.classList.add("nav-moblie");


  console.log('test')
}


let serviceButton = () => {
  const element = document.getElementById('1')
  element.scrollIntoView({ behavior: "smooth", block: "end", inline: "nearest" });
  const element2 = document.getElementById('0')
  element2.classList.remove("nav-moblie")
  console.log('test2')
}



let aboutUsButton = () => {
  const element = document.getElementById('2')
  element.scrollIntoView({ behavior: "smooth", block: "end", inline: "nearest" });
  const element2 = document.getElementById('0')
  element2.classList.remove("nav-moblie")
  console.log('test2')
}


let FAQButton = () => {
  const element = document.getElementById('3')
  element.scrollIntoView({ behavior: "smooth", block: "end", inline: "nearest" });
  const element2 = document.getElementById('0')
  element2.classList.remove("nav-moblie")
  console.log('test2')
}


let contactButton = () => {
  const element = document.getElementById('4')
  element.scrollIntoView({ behavior: "smooth", block: "end", inline: "nearest" });
  const element2 = document.getElementById('0')
  element2.classList.remove("nav-moblie")
  console.log('test2')
}








