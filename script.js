

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


let homeButton = async () => {
  location.assign(`${local}`)
  console.log('go to services')
  }


let contactButton = async () => {
  location.assign(`${local}/contact.html`)
  console.log('go to services')
  }


let serviceButton = async () => {
location.assign(`${local}/index.html#1`)
console.log('go to services')
}



let aboutButton = () => {
location.assign(`${local}/index.html#2`)
console.log('go to about us')
}


let faqButton = () => {
location.assign(`${local}/index.html#3`)
console.log('go to FAQ')
}


let callButton = () => {
  window.open('tel:6782079719', '_self');
  console.log('set up call')
  }

  let emailButton = () => {
    window.open('mailto:sales@newterraconsturction.com', '_self');
    console.log('set up call')
  }


    //form---------------------------------------------------------




    document.getElementById('inquiryForm').addEventListener('submit', function(event) {
      event.preventDefault(); // Prevent form from submitting the traditional way
  
      // Get form values
      const name = document.getElementById('name').value;
      const email = document.getElementById('email').value;
      const message = document.getElementById('message').value;
  
      // Create an object to hold the form data
      const formData = {
          name: name,
          email: email,
          message: message
      };
  
      // Display a message to the user
      document.getElementById('responseMessage').textContent = 'Thank you for your inquiry, ' + formData.name + '! We will get back to you shortly.';
  
      // Optionally, send the form data to a server using Fetch API
      /*
      fetch('https://your-server-endpoint.com/inquiry', {
          method: 'POST',
          headers: {
              'Content-Type': 'application/json'
          },
          body: JSON.stringify(formData)
      })
      .then(response => response.json())
      .then(data => {
          console.log('Success:', data);
      })
      .catch((error) => {
          console.error('Error:', error);
      });
      */
  });









