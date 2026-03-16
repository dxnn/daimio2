import D from '../../1_daimio.js'
// commands for math

// NOTE: we use the fallback type for most of these because they can be either numbers or arrays.

D.import_models({
  math: {
    desc: "Commands for math",
    methods: {

      add: {
        desc: "What kind of snake is good at math?",
        help: [
          'The value and to parameters can be numbers or arrays of numbers.',
          '',
          'Both numbers: Add the two numbers.',
          'One array, no second parameter: Sum the numbers in the array.',
          'One array, one number: Add the number to each item in the array.',
          'Both arrays: Add elements of the arrays pairwise by key',
          '',
          'You can use "add" as an alias for this command.',
        ],
        examples: [
          ['{add 4 to 7}', '11'],
          ['{7 | add 4}', '11'],
          ['{add (1 2 3)}', '6'],
          ['{(1 2 3) | add 3}', '[4,5,6]'],
          ['{math add value (1 2 3) to (6 5 4)}', '[7,7,7]'],
        ],
        params: [
          {
            key: 'value',
            desc: "Augend: a numeric value or array of them",
            type: 'anything',
            required: true
          },
          {
            key: 'to',
            type: 'anything',
            desc: "Addend: a numeric value or array of the same",
          },
        ],
        fun: function(value, to) {
          return D.Etc.Math.solver(value, to, function(a, b) {return a + b;});
        },
      },

      multiply: {
        desc: "Go fort hand",
        help: [
          'The value and to parameters can be numbers or arrays of numbers.',
          '',
          'Both numbers: Multiply the two numbers.',
          'One array, no second parameter: Multiply the numbers in the array.',
          'One array, one number: Multiply the number to each item in the array.',
          'Both arrays: Multiply elements of the arrays pairwise by key',
          '',
          'You can use "multiply" as an alias for this command.',
        ],
        examples: [
          ['{multiply 4 by 7}', '28'],
          ['{7 | multiply 4}', '28'],
          ['{multiply (1 2 3)}', '6'],
          ['{(1 2 3) | multiply 3}', '[3,6,9]'],
          ['{math multiply value (1 2 3) by (6 5 4)}', '[6,10,12]'],
        ],
        params: [
          {
            key: 'value',
            desc: "Factor the first: a numeric value or array of them",
            type: 'anything',
            required: true
          },
          {
            key: 'by',
            desc: "Factor the first: a numeric value or array of such",
            type: 'anything',
          },
        ],
        fun: function(value, by) {
          return D.Etc.Math.solver(value, by, function(a, b) {return a * b;});
        },
      },

      subtract: {
        desc: "Subtract them one from another",
        help: [
          'The value and to parameters can be numbers or arrays of numbers.',
          '',
          'Both numbers: Subtract the two numbers.',
          'One array, no second parameter: Subtract each subsequent item from the first array element.',
          'One array, one number: Subtract the number from each item in the array.',
          'Both arrays: Subtract elements of the second array from the first, pairwise by key',
          '',
          'You can use "subtract" as an alias for this command.',
        ],
        examples: [
          ['{subtract 4 from 7}', '3'],
          ['{7 | subtract 4}', '3'],
          ['{subtract (100 2 3 4 5)}', '86'],
          ['{(1 3 5 7) | subtract 3}', '[-2,0,2,4]'],
          ['{math subtract value (6 5 4) from (1 2 3)}', '[-5,-3,-1]'],
        ],
        params: [
          {
            key: 'value',
            desc: "Subtrahend: a numeric value or array of them",
            type: 'anything',
            required: true
          },
          {
            key: 'from',
            desc: "Minuend: a numeric value or array of such",
            type: 'anything',
          },
        ],
        fun: function(value, from) {
          return D.Etc.Math.solver(from, value, function(a, b) {return a - b;});
        },
      },

      divide: {
        desc: "A method for conquering",
        help: [
          'The value and to parameters can be numbers or arrays of numbers.',
          '',
          'Both numbers: Divide the two numbers.',
          'One array, no second parameter: Divide the first number in the array by each other number.',
          'One array, one number: Divide each item in the array by the number.',
          'Both arrays: Divide elements of the arrays pairwise by key',
          '',
          'You can use "divide" as an alias for this command. When ambiguous read it as _divides_ instead of _divide by_ -- the second example will be confusing otherwise.',
        ],
        examples: [
          ['{divide value 7 by 4}', '1.75'],
          ['{7 | divide by 4}', '1.75'],
          ['{divide value (1 2 3)}', '0.16666666666666666'],
          ['{(1 2 3) | divide by 3}', '[0.3333333333333333,0.6666666666666666,1]'],
          ['{math divide value (1 2 3) by (6 5 4)}', '[0.16666666666666666,0.4,0.75]'],
        ],
        params: [
          {
            key: 'value',
            desc: "Numerator: a numeric value or array of them",
            type: 'anything',
            required: true
          },
          {
            key: 'by',
            desc: "Denominator: a numeric value or array of such",
            type: 'anything',
          },
        ],
        fun: function(value, by) {
          return D.Etc.Math.solver(value, by, function(a, b) {
            if(!b)
              return D.set_error('Division by zero is a crime against nature') || 0
            return a / b
          });
        },
      },

      mod: {
        desc: "Mod some stuff by some other stuff",
        help: [
          'Take the modulo of a value with respect to another value.'
        ],
        examples: [
          ['{math mod value 7 by 2}', '1'],
          ['{7 | mod 2}', '1'],
        ],
        params: [
          {
            key: 'value',
            desc: "A value to be modded",
            type: 'anything',
            required: true
          },
          {
            key: 'by',
            desc: "Value to mod it by",
            type: 'anything',
          },
        ],
        fun: function(value, by) {
          // NOTE: the default JS '%' operator is the remainder. we fiddle with negatives to make this a true modulo operation.
          return D.Etc.Math.solver(value, by, function(a, b) {
            if(!b)
              return D.set_error('Modulation by zero is a crime against nature') || 0

            return a >= 0 == b > 0 ? a % b : a % b + b
            // return a > 0 ^ b > 0 ? -a % b : a % b // so pretty, but so wrong
          })
        },
      },

      pow: {
        desc: "A smack in the face to exponents of exponentiation",
        help: [
          'This raises value to the exp. Fractional exponents are fine, so the square root of five is {5 | math pow exp :0.5}.',
        ],
        examples: [
          ['{math pow value 2 exp 8}', '256'],
          ['{5 | math pow exp :3}', '125'],
          ['{5 | math pow exp :0.5}', '2.23606797749979'],
        ],
        params: [
          {
            key: 'value',
            desc: 'Base',
            type: 'number',
            required: true
          },
          {
            key: 'exp',
            desc: 'Exponent',
            type: 'number',
            required: true
          },
        ],
        fun: function(value, exp) {
          // THINK: can we solver this?
          if(value < 0 && exp % 1)
            return D.set_error('Roots of negatives are not real') || 0

          return Math.pow(value, exp) || 0
        },
      },

      less: {
        desc: "Is value less than than?",
        examples: [
          ['{math less value 3 than 5 | logic if then :yes else :no}', 'yes'],
          ['{math less value 5 than 3 | logic if then :yes else :no}', 'no'],
        ],
        params: [
          {
            key: 'value',
            desc: 'A value',
            type: 'number',
            required: true
          },
          {
            key: 'than',
            desc: 'Another value',
            type: 'number',
            required: true
          },
        ],
        fun: function(value, than) {
          return value < than
        },
      },

      random: {
        desc: "There's random, and then there's AYN random",
        // no examples: output is nondeterministic
        params: [
          {
            key: 'max',
            desc: 'Maximum value (defaults to 1)',
            type: 'number',
          },
        ],
        fun: function(max) {
          if(!max) max = 1
          return Math.floor(Math.random() * (max + 1))
        },
      },

      // TODO: move these into a math-trig handler

      log: {
        desc: "Returns the logarithm, natural by default",
        examples: [
          ['{math log value 100 base 10}', '2'],
        ],
        params: [
          {
            key: 'value',
            desc: 'A number to log',
            type: 'number',
          },
          {
            key: 'base',
            desc: 'Defaults to e',
            type: 'number',
          },
        ],
        fun: function(value, base) {
          return (base ? (Math.log(value) / Math.log(base)) : Math.log(value) ) || 0 // clears out NaNs
        },
      },


      // CAREFUL WHEN YOU ADD asin and acos and also sqrt and log -- all of those can give NaNs!
      sin: {
        desc: "Find out if yours is original",
        examples: [
          ['{90 | math sin}', '1'],
        ],
        params: [
          {
            key: 'value',
            desc: 'In degrees -- I know, right?',
            type: 'number',
          },
        ],
        fun: function(value) {
          return Math.sin(Math.PI * value / 180)
        },
      },

      cos: {
        desc: "The reason we did it: jus",
        examples: [
          ['{0 | math cos}', '1'],
        ],
        params: [
          {
            key: 'value',
            desc: 'In degrees -- I know, right?',
            type: 'number',
          },
        ],
        fun: function(value) {
          return Math.cos(Math.PI * value / 180)
        },
      },

      round: {
        desc: "Round yourself out",
        examples: [
          ['{math round value 3.7}', '4'],
          ['{math round value 3.14159 to 2}', '3.14'],
        ],
        params: [
          {
            key: 'value',
            desc: 'A number',
            type: 'number',
            required: true
          },
          {
            key: 'to',
            desc: "Significant digits",
            type: "number",
          },
        ],
        fun: function(value, to) {
          // THINK: can we accept an array to round?

          if(!to) return Math.round(value)

          var power = Math.pow(10, to)
          return Math.round(value * power) / power
        },
      },

      min: {
        desc: "Find the lowest value",
        examples: [
          ['{math min value (5 3 8 1)}', '1'],
          ['{math min value 5 also 3}', '3'],
        ],
        params: [
          {
            key: 'value',
            desc: 'A number or list of numbers',
            type: 'anything', // [number] | number
            required: true
          },
          {
            key: 'also',
            desc: 'A number',
            type: 'number',
            undefined: true
          },
        ],
        fun: function(value, also) {
          value = D.to_array(value)

          if(also != undefined)
            value.push(also)

          return Math.min.apply(null, value) || 0
        },
      },

      max: {
        desc: "Find the highest value",
        examples: [
          ['{math max value (5 3 8 1)}', '8'],
          ['{math max value 5 also 8}', '8'],
        ],
        params: [
          {
            key: 'value',
            desc: 'A list of numbers',
            type: 'anything', // [number] | number
            required: true
          },
          {
            key: 'also',
            desc: 'A number',
            type: 'number',
            undefined: true
          },
        ],
        fun: function(value, also) {
          value = D.to_array(value)

          if(also != undefined)
            value.push(also)

          return Math.max.apply(null, value) || 0
        },
      },


    }
  }
});

D.Etc.Math = {}

D.Etc.Math.solver = function(value, to, fun) {
  // TODO: we don't need this if the type is "array|number"
  value = (typeof value == 'object') ? D.to_array(value) : value
  to = (typeof to == 'object') ? D.to_array(to) : to
  // var arrays = (typeof value == 'object') + (typeof to == 'object');

  // are these arrays or numbers?
  var arrays = Array.isArray(value) + Array.isArray(to)

  // THINK: maybe wrap these with D.to_numeric to keep out NaNs
  if(arrays == 2) return D.Etc.Math.doubleArray(value, to, fun);
  if(arrays == 1) return D.Etc.Math.singleArray(value, to, fun);
  if(arrays == 0) return D.Etc.Math.naryanArray(value, to, fun);
};

D.Etc.Math.doubleArray = function(value, to, fun) {
  return value.map(function(val, key) {
    return fun(D.to_numeric(val), D.to_numeric(to[key]));
  });
};

D.Etc.Math.singleArray = function(value, to, fun) {
  // ensure value is the array
  if(typeof value != 'object') {
    var temp = to; to = value; value = temp;
  }

  // one array, one number
  if(to === false || to === null) to = 0                             // false/null mean zero (e.g. undefined var)
  if(D.is_numeric(to)) {
    return value.map(function(val) {
      return fun(D.to_numeric(val), D.to_numeric(to));
    });
  }

  // just the one array
  var total = false;
  value = D.to_array(value);
  for(var i=0, l=value.length; i < l; i++) {
    // NOTE: this essentially bypasses identity concerns -- total=0 poisons *, total=1 taints +. it means subtraction and division are relative to the first value in the array, but that's ok.
    if(total === false) total = D.to_numeric(value[i]);
    else total = fun(total, D.to_numeric(value[i]));
  }
  return total;
};

D.Etc.Math.naryanArray = function(value, to, fun) {
  if(!D.is_numeric(value)) {
    if(value)
      D.set_error("That is not a numeric value")
    value = 0
  }
  if(!D.is_numeric(to)) {
    // D.to_numeric(value)
    to = 0
  }
  return fun(D.to_numeric(value), D.to_numeric(to));
};
